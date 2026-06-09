import type { DatabaseSync } from "node:sqlite"
import { createUsageRangeFilter } from "../usage-analysis/range"
import { findModelPriceRuleForModel } from "./matching"
import type {
  ModelPriceCoverageInput,
  ModelPriceCoverageRange,
  ModelPriceCoverageRow,
  ModelPriceCoverageSource,
  ModelPriceRule,
  ModelPriceUsageSourceName,
} from "./types"

type UsagePrefix = "cc" | "cx"

type UsedModelAccumulator = Omit<ModelPriceCoverageRow, "sources" | "priceKnown" | "matchedRuleId" | "matchedRulePattern"> & {
  readonly sources: Set<ModelPriceUsageSourceName>
}

const RANGE_PRESETS: readonly ModelPriceCoverageRange[] = ["today", "7d", "30d", "90d", "all"]

export function listModelPriceCoverage(
  db: DatabaseSync,
  rules: readonly ModelPriceRule[],
  input: ModelPriceCoverageInput = {},
): ModelPriceCoverageRow[] {
  const source = normalizeSource(input.source)
  const range = normalizeRange(input.range)
  const limit = normalizeLimit(input.limit)
  const byModel = new Map<string, UsedModelAccumulator>()

  for (const item of selectedSources(source)) {
    for (const row of queryUsedModels(db, item.prefix, range)) {
      const current = byModel.get(row.model) ?? {
        model: row.model,
        sources: new Set<ModelPriceUsageSourceName>(),
        tokens: 0,
        requests: 0,
        pricedTokens: 0,
        unpricedTokens: 0,
        estimatedCost: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
      }
      current.sources.add(item.name)
      byModel.set(row.model, {
        ...current,
        tokens: current.tokens + row.tokens,
        requests: current.requests + row.requests,
        pricedTokens: current.pricedTokens + row.pricedTokens,
        unpricedTokens: current.unpricedTokens + row.unpricedTokens,
        estimatedCost: current.estimatedCost + row.estimatedCost,
        input: current.input + row.input,
        output: current.output + row.output,
        cacheRead: current.cacheRead + row.cacheRead,
        cacheWrite: current.cacheWrite + row.cacheWrite,
        reasoning: current.reasoning + row.reasoning,
      })
    }
  }

  return [...byModel.values()]
    .sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    .slice(0, limit)
    .map((row) => {
      const matchedRule = findModelPriceRuleForModel(row.model, rules)
      return {
        ...row,
        sources: [...row.sources].sort() as ModelPriceUsageSourceName[],
        priceKnown: matchedRule !== null,
        ...(matchedRule ? { matchedRuleId: matchedRule.id, matchedRulePattern: matchedRule.modelPattern } : {}),
      }
    })
}

function normalizeSource(value: unknown): ModelPriceCoverageSource {
  if (value === undefined) return "all"
  if (value === "all" || value === "cc" || value === "codex") return value
  throw new Error("Invalid 'source': expected all, cc, or codex")
}

function normalizeRange(value: unknown): ModelPriceCoverageRange {
  if (value === undefined) return "all"
  if (typeof value === "string" && RANGE_PRESETS.includes(value as ModelPriceCoverageRange)) return value as ModelPriceCoverageRange
  throw new Error("Invalid 'range': expected today, 7d, 30d, 90d, or all")
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 200
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) throw new Error("Invalid 'limit': expected positive number")
  return Math.floor(value)
}

function selectedSources(source: ModelPriceCoverageSource): Array<{ prefix: UsagePrefix; name: ModelPriceUsageSourceName }> {
  if (source === "cc") return [{ prefix: "cc", name: "cc" }]
  if (source === "codex") return [{ prefix: "cx", name: "codex" }]
  return [
    { prefix: "cc", name: "cc" },
    { prefix: "cx", name: "codex" },
  ]
}

function queryUsedModels(db: DatabaseSync, prefix: UsagePrefix, preset: ModelPriceCoverageRange): Array<Omit<UsedModelAccumulator, "sources">> {
  const filter = createUsageRangeFilter({ preset })
  const where: string[] = ["model != ''"]
  const params: Array<string | number> = []
  if (filter.sinceTimestampMs !== undefined) {
    where.push("timestamp_ms >= ?")
    params.push(filter.sinceTimestampMs)
  } else if (filter.sinceDate) {
    where.push("date >= ?")
    params.push(filter.sinceDate)
  }
  if (filter.untilTimestampMs !== undefined) {
    where.push("timestamp_ms <= ?")
    params.push(filter.untilTimestampMs)
  } else if (filter.untilDate) {
    where.push("date <= ?")
    params.push(filter.untilDate)
  }
  const rows = db.prepare(`
    SELECT
      model,
      COALESCE(SUM(input_tokens), 0) AS input,
      COALESCE(SUM(output_tokens), 0) AS output,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
      COALESCE(SUM(cache_write_tokens), 0) AS cache_write,
      COALESCE(SUM(reasoning_tokens), 0) AS reasoning,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens), 0) AS tokens,
      COALESCE(SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END), 0) AS priced_tokens,
      COALESCE(SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END), 0) AS unpriced_tokens,
      COALESCE(SUM(total_cost), 0) AS estimated_cost,
      COUNT(*) AS requests
    FROM ${prefix}_usage_events
    WHERE ${where.join(" AND ")}
    GROUP BY model
    HAVING tokens > 0
  `).all(...params) as Record<string, unknown>[]

  return rows.map((row) => ({
    model: String(row.model ?? "unknown"),
    tokens: toNumber(row.tokens),
    requests: toNumber(row.requests),
    pricedTokens: toNumber(row.priced_tokens),
    unpricedTokens: toNumber(row.unpriced_tokens),
    estimatedCost: toNumber(row.estimated_cost),
    input: toNumber(row.input),
    output: toNumber(row.output),
    cacheRead: toNumber(row.cache_read),
    cacheWrite: toNumber(row.cache_write),
    reasoning: toNumber(row.reasoning),
  }))
}

function toNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}
