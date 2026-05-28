import type { DatabaseSync } from "node:sqlite"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import {
  createUsagePriceRule,
  deleteUsagePriceRule,
  findUsagePriceRuleForModel,
  getUsagePriceRule,
  listUsagePriceRules,
  setUsagePriceRuleEnabled,
  updateUsagePriceRule,
  type UsageModelPriceRulePatch,
} from "../services/usage-analysis/pricing"
import { createUsageRangeFilter } from "../services/usage-analysis/range"
import type { UsageRangePreset } from "../services/usage-analysis/types"

type ModelPriceSource = "all" | "cc" | "codex"
type UsagePrefix = "cc" | "cx"
type UsageSourceName = "cc" | "codex"

type ModelPriceDispatcherDeps = {
  readonly db: DatabaseSync
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
}

type UsedModelRow = {
  readonly model: string
  readonly sources: UsageSourceName[]
  readonly tokens: number
  readonly requests: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly priceKnown: boolean
  readonly matchedRuleId?: string
  readonly matchedRulePattern?: string
}

type UsedModelAccumulator = Omit<UsedModelRow, "sources" | "priceKnown" | "matchedRuleId" | "matchedRulePattern"> & {
  readonly sources: Set<UsageSourceName>
}
type MutableUsageModelPriceRulePatch = {
  -readonly [Key in keyof UsageModelPriceRulePatch]: UsageModelPriceRulePatch[Key]
}

const RANGE_PRESETS: readonly UsageRangePreset[] = ["today", "7d", "30d", "90d", "all"]
const PRICE_FIELDS = ["inputPer1M", "outputPer1M", "cacheReadPer1M", "cacheWritePer1M", "reasoningPer1M"] as const
const MODEL_PRICE_MUTATION_ACTIONS = new Set([
  "model_price.rule.create",
  "model_price.rule.update",
  "model_price.rule.delete",
  "model_price.rule.enable",
  "model_price.rule.disable",
])
const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }

export function createModelPriceCapabilityDispatcher(deps: ModelPriceDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const security = modelPriceMutationSecurity(deps, action, params, context)
      if (security) await authorizeModelPriceMutation(deps, security)
      try {
        const result = dispatchModelPriceAction(deps.db, action, params)
        if (security) {
          deps.auditSink?.record({
            action: "database.mutate",
            actor: security.actor,
            resource: security.resource,
            outcome: "allowed",
            metadata: security.metadata,
          })
        }
        return result
      } catch (error) {
        if (security) {
          deps.auditSink?.record({
            action: "database.mutate",
            actor: security.actor,
            resource: security.resource,
            outcome: "failed",
            metadata: {
              ...security.metadata,
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: String(error).length,
            },
          })
        }
        throw error
      }
    },
  }
}

function dispatchModelPriceAction(
  db: DatabaseSync,
  action: string,
  params: Record<string, unknown>,
): DispatchResult {
  switch (action) {
    case "model_price.used_model.list":
      return { ok: true, data: listUsedModels(db, params) }
    case "model_price.rule.list":
      return { ok: true, data: listUsagePriceRules(db) }
    case "model_price.rule.get":
      return { ok: true, data: requireRule(db, requireString(params, "ruleId")) }
    case "model_price.rule.create":
      return { ok: true, data: createUsagePriceRule(db, readCreateParams(params)) }
    case "model_price.rule.update":
      return { ok: true, data: updateUsagePriceRule(db, requireString(params, "ruleId"), readPatchParams(params)) }
    case "model_price.rule.delete":
      return { ok: true, data: deleteUsagePriceRule(db, requireString(params, "ruleId")) }
    case "model_price.rule.enable":
      return { ok: true, data: setUsagePriceRuleEnabled(db, requireString(params, "ruleId"), true) }
    case "model_price.rule.disable":
      return { ok: true, data: setUsagePriceRuleEnabled(db, requireString(params, "ruleId"), false) }
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

type ModelPriceMutationSecurity = {
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

function modelPriceMutationSecurity(
  deps: ModelPriceDispatcherDeps,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): ModelPriceMutationSecurity | null {
  if (!MODEL_PRICE_MUTATION_ACTIONS.has(action)) return null
  const ruleId = typeof params.ruleId === "string" && params.ruleId.trim() ? params.ruleId.trim() : action
  return {
    actor: deps.actor ?? DEFAULT_ACTOR,
    resource: `model-price-rule:${ruleId}`,
    metadata: {
      source: context.source ?? "api",
      modelPriceAction: action,
      ...(ruleId !== action ? { ruleId } : undefined),
    },
  }
}

async function authorizeModelPriceMutation(
  deps: ModelPriceDispatcherDeps,
  security: ModelPriceMutationSecurity,
): Promise<void> {
  const permission = await deps.permissionGuard?.check({
    action: "database.mutate",
    actor: security.actor,
    resource: security.resource,
    context: security.metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "database.mutate",
      actor: security.actor,
      resource: security.resource,
      outcome: "denied",
      metadata: {
        ...security.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  }
  return value.trim()
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`Invalid '${key}': expected boolean`)
  return value
}

function optionalPrice(params: Record<string, unknown>, key: typeof PRICE_FIELDS[number]): number | undefined {
  const value = params[key]
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid '${key}': expected number >= 0`)
  }
  return value
}

function readCreateParams(params: Record<string, unknown>) {
  return {
    modelPattern: requireString(params, "modelPattern"),
    inputPer1M: optionalPrice(params, "inputPer1M"),
    outputPer1M: optionalPrice(params, "outputPer1M"),
    cacheReadPer1M: optionalPrice(params, "cacheReadPer1M"),
    cacheWritePer1M: optionalPrice(params, "cacheWritePer1M"),
    reasoningPer1M: optionalPrice(params, "reasoningPer1M"),
    enabled: optionalBoolean(params, "enabled") ?? true,
  }
}

function readPatchParams(params: Record<string, unknown>): UsageModelPriceRulePatch {
  const patch: MutableUsageModelPriceRulePatch = {}
  if ("modelPattern" in params) patch.modelPattern = requireString(params, "modelPattern")
  for (const field of PRICE_FIELDS) {
    if (field in params) {
      const value = optionalPrice(params, field)
      if (value !== undefined) patch[field] = value
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("No model price fields provided for update")
  }
  return patch
}

function requireRule(db: DatabaseSync, ruleId: string) {
  const rule = getUsagePriceRule(db, ruleId)
  if (!rule) throw new Error(`Model price rule not found: ${ruleId}`)
  return rule
}

function normalizeSource(value: unknown): ModelPriceSource {
  if (value === undefined) return "all"
  if (value === "all" || value === "cc" || value === "codex") return value
  throw new Error("Invalid 'source': expected all, cc, or codex")
}

function normalizeRange(value: unknown): UsageRangePreset {
  if (value === undefined) return "all"
  if (typeof value === "string" && RANGE_PRESETS.includes(value as UsageRangePreset)) return value as UsageRangePreset
  throw new Error("Invalid 'range': expected today, 7d, 30d, 90d, or all")
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) return 200
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error("Invalid 'limit': expected positive number")
  }
  return Math.floor(value)
}

function selectedSources(source: ModelPriceSource): Array<{ prefix: UsagePrefix; name: UsageSourceName }> {
  if (source === "cc") return [{ prefix: "cc", name: "cc" }]
  if (source === "codex") return [{ prefix: "cx", name: "codex" }]
  return [
    { prefix: "cc", name: "cc" },
    { prefix: "cx", name: "codex" },
  ]
}

function listUsedModels(db: DatabaseSync, params: Record<string, unknown>): UsedModelRow[] {
  const source = normalizeSource(params.source)
  const range = normalizeRange(params.range)
  const limit = normalizeLimit(params.limit)
  const rules = listUsagePriceRules(db)
  const byModel = new Map<string, UsedModelAccumulator>()

  for (const item of selectedSources(source)) {
    for (const row of queryUsedModels(db, item.prefix, range)) {
      const current = byModel.get(row.model) ?? {
        model: row.model,
        sources: new Set<UsageSourceName>(),
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
      const matchedRule = findUsagePriceRuleForModel(row.model, rules)
      return {
        ...row,
        sources: [...row.sources].sort() as UsageSourceName[],
        priceKnown: matchedRule !== null,
        ...(matchedRule ? { matchedRuleId: matchedRule.id, matchedRulePattern: matchedRule.modelPattern } : {}),
      }
    })
}

function queryUsedModels(db: DatabaseSync, prefix: UsagePrefix, preset: UsageRangePreset): Array<Omit<UsedModelAccumulator, "sources">> {
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
