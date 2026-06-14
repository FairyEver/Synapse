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
import {
  MODEL_PRICE_COVERAGE_DEFAULT_LIMIT,
  MODEL_PRICE_COVERAGE_MAX_LIMIT,
} from "./types"

type UsagePrefix = "cc" | "cx"

type UsedModelQueryRow = Omit<ModelPriceCoverageRow, "priceKnown" | "matchedRuleId" | "matchedRulePattern">

const RANGE_PRESETS: readonly ModelPriceCoverageRange[] = ["today", "7d", "30d", "90d", "all"]

export function listModelPriceCoverage(
  db: DatabaseSync,
  rules: readonly ModelPriceRule[],
  input: ModelPriceCoverageInput = {},
): ModelPriceCoverageRow[] {
  const source = normalizeSource(input.source)
  const range = normalizeRange(input.range)
  const limit = normalizeLimit(input.limit)

  return queryUsedModels(db, source, range, limit)
    .map((row) => {
      const matchedRule = findModelPriceRuleForModel(row.model, rules)
      return {
        ...row,
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
  if (value === undefined) return MODEL_PRICE_COVERAGE_DEFAULT_LIMIT
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) throw new Error("Invalid 'limit': expected positive number")
  return Math.min(Math.floor(value), MODEL_PRICE_COVERAGE_MAX_LIMIT)
}

function queryUsedModels(
  db: DatabaseSync,
  source: ModelPriceCoverageSource,
  preset: ModelPriceCoverageRange,
  limit: number,
): UsedModelQueryRow[] {
  if (source === "all") return queryAllUsedModels(db, preset, limit)
  const prefix = source === "cc" ? "cc" : "cx"
  const sourceName = source === "cc" ? "cc" : "codex"
  return querySingleSourceUsedModels(db, prefix, sourceName, preset, limit)
}

function createUsageWhere(preset: ModelPriceCoverageRange): {
  readonly params: Array<string | number>
  readonly where: string
} {
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
  return { where: where.join(" AND "), params }
}

function querySingleSourceUsedModels(
  db: DatabaseSync,
  prefix: UsagePrefix,
  sourceName: ModelPriceUsageSourceName,
  preset: ModelPriceCoverageRange,
  limit: number,
): UsedModelQueryRow[] {
  const { where, params } = createUsageWhere(preset)
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
    WHERE ${where}
    GROUP BY model
    HAVING tokens > 0
    ORDER BY tokens DESC, model ASC
    LIMIT ?
  `).all(...params, limit) as Record<string, unknown>[]

  return rows.map((row) => rowFromSql(row, [sourceName]))
}

function queryAllUsedModels(
  db: DatabaseSync,
  preset: ModelPriceCoverageRange,
  limit: number,
): UsedModelQueryRow[] {
  const { where, params } = createUsageWhere(preset)
  const rows = db.prepare(`
    SELECT
      model,
      COALESCE(SUM(input), 0) AS input,
      COALESCE(SUM(output), 0) AS output,
      COALESCE(SUM(cache_read), 0) AS cache_read,
      COALESCE(SUM(cache_write), 0) AS cache_write,
      COALESCE(SUM(reasoning), 0) AS reasoning,
      COALESCE(SUM(tokens), 0) AS tokens,
      COALESCE(SUM(priced_tokens), 0) AS priced_tokens,
      COALESCE(SUM(unpriced_tokens), 0) AS unpriced_tokens,
      COALESCE(SUM(estimated_cost), 0) AS estimated_cost,
      COALESCE(SUM(requests), 0) AS requests,
      COALESCE(SUM(cc_requests), 0) AS cc_requests,
      COALESCE(SUM(codex_requests), 0) AS codex_requests
    FROM (
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
        COUNT(*) AS requests,
        COUNT(*) AS cc_requests,
        0 AS codex_requests
      FROM cc_usage_events
      WHERE ${where}
      GROUP BY model
      HAVING tokens > 0
      UNION ALL
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
        COUNT(*) AS requests,
        0 AS cc_requests,
        COUNT(*) AS codex_requests
      FROM cx_usage_events
      WHERE ${where}
      GROUP BY model
      HAVING tokens > 0
    )
    GROUP BY model
    HAVING tokens > 0
    ORDER BY tokens DESC, model ASC
    LIMIT ?
  `).all(...params, ...params, limit) as Record<string, unknown>[]

  return rows.map((row) => {
    const sources: ModelPriceUsageSourceName[] = []
    if (toNumber(row.cc_requests) > 0) sources.push("cc")
    if (toNumber(row.codex_requests) > 0) sources.push("codex")
    return rowFromSql(row, sources)
  })
}

function rowFromSql(row: Record<string, unknown>, sources: ModelPriceUsageSourceName[]): UsedModelQueryRow {
  return {
    model: String(row.model ?? "unknown"),
    sources,
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
  }
}

function toNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}
