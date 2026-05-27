import type { DatabaseSync } from "node:sqlite"
import { SYNAPSE_COST_CURRENCY, type SynapseCostCurrency } from "../../../action-packages/shared/cost-currency"
import type { UsageTokenBreakdown } from "./types"

export interface UsageModelPriceRuleInput {
  readonly id?: string
  readonly modelPattern: string
  readonly inputPer1M?: number
  readonly outputPer1M?: number
  readonly cacheReadPer1M?: number
  readonly cacheWritePer1M?: number
  readonly reasoningPer1M?: number
  readonly currency?: SynapseCostCurrency
  readonly enabled?: boolean
  readonly source?: "builtin" | "user"
  readonly sortIndex?: number
  readonly updatedAt?: string
}

export interface UsageModelPriceRule {
  readonly id: string
  readonly modelPattern: string
  readonly inputPer1M: number
  readonly outputPer1M: number
  readonly cacheReadPer1M: number
  readonly cacheWritePer1M: number
  readonly reasoningPer1M: number
  readonly currency: SynapseCostCurrency
  readonly enabled: boolean
  readonly source: "builtin" | "user"
  readonly sortIndex: number
  readonly updatedAt: string
}

export interface EstimatedUsageCost {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly total: number
  readonly priceKnown: boolean
}

interface PriceRuleRow {
  readonly id: string
  readonly model_pattern: string
  readonly input_per_1m: number
  readonly output_per_1m: number
  readonly cache_read_per_1m: number
  readonly cache_write_per_1m: number
  readonly reasoning_per_1m: number
  readonly currency: string
  readonly enabled: number
  readonly source: string
  readonly sort_index: number
  readonly updated_at: string
}

const PRICING_SEED_META_KEY = "default_model_prices_seeded"

const DEFAULT_USAGE_PRICE_RULE_INPUTS: readonly UsageModelPriceRuleInput[] = [
  { id: "gpt-5-5", modelPattern: "gpt-5.5", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "gpt-5-4", modelPattern: "gpt-5.4", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "gpt-5-3-codex", modelPattern: "gpt-5.3-codex", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "gpt-5-codex", modelPattern: "gpt-5-codex", inputPer1M: 9, outputPer1M: 72, cacheReadPer1M: 0.9, reasoningPer1M: 72, source: "builtin" },
  { id: "claude-opus-4-6", modelPattern: "claude-opus-4.6", inputPer1M: 108, outputPer1M: 540, cacheReadPer1M: 10.8, cacheWritePer1M: 135, reasoningPer1M: 540, source: "builtin" },
  { id: "claude-opus-4", modelPattern: "claude-opus-4", inputPer1M: 108, outputPer1M: 540, cacheReadPer1M: 10.8, cacheWritePer1M: 135, reasoningPer1M: 540, source: "builtin" },
  { id: "claude-sonnet-4", modelPattern: "claude-sonnet-4", inputPer1M: 21.6, outputPer1M: 108, cacheReadPer1M: 2.16, cacheWritePer1M: 27, reasoningPer1M: 108, source: "builtin" },
  { id: "claude-haiku-4", modelPattern: "claude-haiku-4", inputPer1M: 7.2, outputPer1M: 36, cacheReadPer1M: 0.72, cacheWritePer1M: 9, reasoningPer1M: 36, source: "builtin" },
]

export const DEFAULT_USAGE_PRICE_RULES = normalizeUsagePriceRules(DEFAULT_USAGE_PRICE_RULE_INPUTS)

function cost(tokens: number, per1M: number): number {
  if (per1M <= 0 || tokens <= 0) return 0
  return (tokens / 1_000_000) * per1M
}

function normalizePrice(value: unknown): number {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : 0
}

function normalizeSource(value: unknown): "builtin" | "user" {
  return value === "builtin" ? "builtin" : "user"
}

function normalizeRuleId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || "price-rule"
}

function wildcardPatternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`, "i")
}

function matchesModelPattern(model: string, pattern: string): boolean {
  const normalizedModel = model.trim().toLowerCase()
  const normalizedPattern = pattern.trim().toLowerCase()
  if (!normalizedModel || !normalizedPattern) return false
  if (normalizedPattern.includes("*")) return wildcardPatternToRegex(normalizedPattern).test(normalizedModel)
  return normalizedModel.includes(normalizedPattern)
}

function findRule(model: string, rules: readonly UsageModelPriceRule[]): UsageModelPriceRule | null {
  return rules
    .filter((rule) => rule.enabled)
    .find((rule) => matchesModelPattern(model, rule.modelPattern)) ?? null
}

function makeRuleId(input: UsageModelPriceRuleInput, index: number, usedIds: Set<string>): string {
  const base = normalizeRuleId(input.id || input.modelPattern || `price-rule-${index + 1}`)
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}

export function normalizeUsagePriceRules(inputs: readonly UsageModelPriceRuleInput[]): UsageModelPriceRule[] {
  const usedIds = new Set<string>()
  const now = new Date().toISOString()
  return inputs
    .map((input, index) => {
      const modelPattern = input.modelPattern.trim()
      if (!modelPattern) return null
      return {
        id: makeRuleId(input, index, usedIds),
        modelPattern,
        inputPer1M: normalizePrice(input.inputPer1M),
        outputPer1M: normalizePrice(input.outputPer1M),
        cacheReadPer1M: normalizePrice(input.cacheReadPer1M),
        cacheWritePer1M: normalizePrice(input.cacheWritePer1M),
        reasoningPer1M: normalizePrice(input.reasoningPer1M),
        currency: input.currency ?? SYNAPSE_COST_CURRENCY,
        enabled: input.enabled ?? true,
        source: normalizeSource(input.source),
        sortIndex: Number.isFinite(Number(input.sortIndex)) ? Number(input.sortIndex) : index,
        updatedAt: input.updatedAt || now,
      } satisfies UsageModelPriceRule
    })
    .filter((rule): rule is UsageModelPriceRule => rule !== null)
    .sort((a, b) => a.sortIndex - b.sortIndex || b.modelPattern.length - a.modelPattern.length)
}

export function estimateUsageCost(
  model: string,
  tokens: UsageTokenBreakdown,
  rules: readonly UsageModelPriceRule[] = DEFAULT_USAGE_PRICE_RULES,
): EstimatedUsageCost {
  const rule = findRule(model, rules)
  if (!rule) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, priceKnown: false }
  }

  const input = cost(tokens.input, rule.inputPer1M)
  const output = cost(tokens.output, rule.outputPer1M)
  const cacheRead = cost(tokens.cacheRead, rule.cacheReadPer1M)
  const cacheWrite = cost(tokens.cacheWrite, rule.cacheWritePer1M)
  const reasoning = cost(tokens.reasoning, rule.reasoningPer1M)

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total: input + output + cacheRead + cacheWrite + reasoning,
    priceKnown: true,
  }
}

export function seedDefaultUsagePriceRules(database: DatabaseSync): void {
  const meta = database.prepare("SELECT value FROM usage_pricing_meta WHERE key = ?").get(PRICING_SEED_META_KEY) as { value?: string } | undefined
  if (meta?.value) return
  const count = database.prepare("SELECT COUNT(*) AS count_value FROM usage_model_prices").get() as { count_value?: number } | undefined
  if (Number(count?.count_value ?? 0) === 0) {
    insertUsagePriceRules(database, DEFAULT_USAGE_PRICE_RULES)
  }
  database.prepare(`
    INSERT OR REPLACE INTO usage_pricing_meta (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(PRICING_SEED_META_KEY, "1", new Date().toISOString())
}

export function listUsagePriceRules(database: DatabaseSync): UsageModelPriceRule[] {
  const rows = database.prepare(`
    SELECT
      id,
      model_pattern,
      input_per_1m,
      output_per_1m,
      cache_read_per_1m,
      cache_write_per_1m,
      reasoning_per_1m,
      currency,
      enabled,
      source,
      sort_index,
      updated_at
    FROM usage_model_prices
    ORDER BY sort_index ASC, LENGTH(model_pattern) DESC, model_pattern ASC
  `).all() as unknown as PriceRuleRow[]
  return rows.map((row) => ({
    id: row.id,
    modelPattern: row.model_pattern,
    inputPer1M: normalizePrice(row.input_per_1m),
    outputPer1M: normalizePrice(row.output_per_1m),
    cacheReadPer1M: normalizePrice(row.cache_read_per_1m),
    cacheWritePer1M: normalizePrice(row.cache_write_per_1m),
    reasoningPer1M: normalizePrice(row.reasoning_per_1m),
    currency: SYNAPSE_COST_CURRENCY,
    enabled: row.enabled === 1,
    source: normalizeSource(row.source),
    sortIndex: Number(row.sort_index),
    updatedAt: row.updated_at,
  }))
}

export function saveUsagePriceRules(database: DatabaseSync, inputs: readonly UsageModelPriceRuleInput[]): UsageModelPriceRule[] {
  const rules = normalizeUsagePriceRules(inputs.map((rule, index) => ({
    ...rule,
    source: rule.source ?? "user",
    sortIndex: index,
    updatedAt: new Date().toISOString(),
  })))
  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    database.exec("DELETE FROM usage_model_prices")
    insertUsagePriceRules(database, rules)
    database.prepare(`
      INSERT OR REPLACE INTO usage_pricing_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(PRICING_SEED_META_KEY, "1", new Date().toISOString())
    database.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    throw error
  }
  return rules
}

function insertUsagePriceRules(database: DatabaseSync, rules: readonly UsageModelPriceRule[]): void {
  const insert = database.prepare(`
    INSERT INTO usage_model_prices (
      id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m,
      cache_write_per_1m, reasoning_per_1m, currency, enabled, source, sort_index, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const rule of rules) {
    insert.run(
      rule.id,
      rule.modelPattern,
      rule.inputPer1M,
      rule.outputPer1M,
      rule.cacheReadPer1M,
      rule.cacheWritePer1M,
      rule.reasoningPer1M,
      rule.currency,
      rule.enabled ? 1 : 0,
      rule.source,
      rule.sortIndex,
      rule.updatedAt,
    )
  }
}
