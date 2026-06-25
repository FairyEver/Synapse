import type { DatabaseSync } from "node:sqlite"
import { listModelPriceCoverage } from "./coverage"
import { initModelPriceSchema } from "./db-schema"
import {
  compareModelPriceRules,
  estimateModelUsageCost,
  findModelPriceRuleForModel,
  normalizeModelPriceRules,
} from "./matching"
import { getModelPricePreset, listModelPricePresetSummaries } from "./presets"
import { createModelPriceRuleId, normalizeModelPatternKey } from "./rule-id"
import type {
  EstimatedModelUsageCost,
  ModelPriceCoverageInput,
  ModelPricePresetId,
  ModelPricePresetSummary,
  ModelPriceCoverageRow,
  ModelPriceRule,
  ModelPriceRuleDeleteResult,
  ModelPriceRuleInput,
  ModelPriceRulePatch,
  ModelUsageTokenBreakdown,
} from "./types"

interface ModelPriceRuleRow {
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

export { initModelPriceSchema }

export class ModelPriceService {
  constructor(private readonly db: DatabaseSync) {}

  listRules(): ModelPriceRule[] {
    return listModelPriceRules(this.db)
  }

  listPresets(): ModelPricePresetSummary[] {
    return listModelPricePresetSummaries()
  }

  saveRules(inputs: readonly ModelPriceRuleInput[]): ModelPriceRule[] {
    const now = new Date().toISOString()
    const rules = normalizeModelPriceRules(inputs.map((rule, index) => ({
      ...rule,
      source: rule.source ?? "user",
      sortIndex: index,
      updatedAt: now,
    })))
    replaceModelPriceRules(this.db, rules)
    return rules
  }

  clearRules(): ModelPriceRule[] {
    replaceModelPriceRules(this.db, [])
    return []
  }

  importPreset(presetId: ModelPricePresetId): ModelPriceRule[] {
    return this.importPresets([presetId])
  }

  importPresets(presetIds: readonly ModelPricePresetId[]): ModelPriceRule[] {
    const presets = presetIds.map((presetId) => {
      const preset = getModelPricePreset(presetId)
      if (!preset) throw new Error(`Unknown model price preset: ${presetId}`)
      return preset
    })

    const now = new Date().toISOString()
    let result: ModelPriceRuleInput[] = this.listRules()

    for (const preset of presets) {
      const highestSortIndex = result.reduce((max, rule) => Math.max(max, rule.sortIndex ?? -1), -1)
      const presetRulesByPattern = new Map(preset.rules.map((rule) => [normalizeModelPatternKey(rule.modelPattern), rule] as const))
      const nextResult: ModelPriceRuleInput[] = []
      const matchedPatterns = new Set<string>()
      let nextSortIndex = highestSortIndex + 1

      for (const rule of result) {
        const key = normalizeModelPatternKey(rule.modelPattern)
        const presetRule = presetRulesByPattern.get(key)
        if (!presetRule) {
          nextResult.push(rule)
          continue
        }

        if (matchedPatterns.has(key)) {
          continue
        }

        matchedPatterns.add(key)
        nextResult.push({
          ...presetRule,
          id: createModelPriceRuleId(`preset:${preset.id}`, presetRule.modelPattern),
          source: "builtin",
          updatedAt: now,
          sortIndex: rule.sortIndex,
        })
      }

      for (const [key, rule] of presetRulesByPattern) {
        if (matchedPatterns.has(key)) continue
        nextResult.push({
          ...rule,
          id: createModelPriceRuleId(`preset:${preset.id}`, rule.modelPattern),
          source: "builtin",
          updatedAt: now,
          sortIndex: nextSortIndex,
        })
        nextSortIndex += 1
      }

      result = nextResult
    }

    const rules = normalizeModelPriceRules(result)
    replaceModelPriceRules(this.db, rules)
    return rules
  }

  getRule(ruleId: string): ModelPriceRule | null {
    return this.listRules().find((rule) => rule.id === ruleId) ?? null
  }

  createRule(input: ModelPriceRuleInput): ModelPriceRule {
    const existing = this.listRules()
    const now = new Date().toISOString()
    const rules = normalizeModelPriceRules([
      ...existing,
      { ...input, source: input.source ?? "user", sortIndex: existing.length, updatedAt: now },
    ])
    replaceModelPriceRules(this.db, rules)
    return rules.find((rule) => rule.updatedAt === now && rule.modelPattern === input.modelPattern.trim()) ?? rules[rules.length - 1]
  }

  updateRule(ruleId: string, patch: ModelPriceRulePatch): ModelPriceRule {
    const existing = this.listRules()
    if (!existing.some((rule) => rule.id === ruleId)) throw new Error(`Model price rule not found: ${ruleId}`)
    const now = new Date().toISOString()
    const rules = normalizeModelPriceRules(existing.map((rule) => (
      rule.id === ruleId ? { ...rule, ...patch, id: rule.id, updatedAt: now } : rule
    )))
    replaceModelPriceRules(this.db, rules)
    const updated = rules.find((rule) => rule.id === ruleId)
    if (!updated) throw new Error(`Model price rule not found after update: ${ruleId}`)
    return updated
  }

  setRuleEnabled(ruleId: string, enabled: boolean): ModelPriceRule {
    return this.updateRule(ruleId, { enabled })
  }

  deleteRule(ruleId: string): ModelPriceRuleDeleteResult {
    const existing = this.listRules()
    if (!existing.some((rule) => rule.id === ruleId)) throw new Error(`Model price rule not found: ${ruleId}`)
    replaceModelPriceRules(this.db, normalizeModelPriceRules(existing.filter((rule) => rule.id !== ruleId)))
    return { deleted: true, ruleId }
  }

  findRuleForModel(model: string): ModelPriceRule | null {
    return findModelPriceRuleForModel(model, this.listRules())
  }

  estimateUsageCost(model: string, tokens: ModelUsageTokenBreakdown): EstimatedModelUsageCost {
    return estimateModelUsageCost(model, tokens, this.listRules())
  }

  listCoverage(input: ModelPriceCoverageInput = {}): ModelPriceCoverageRow[] {
    return listModelPriceCoverage(this.db, this.listRules(), input)
  }
}

export function listModelPriceRules(database: DatabaseSync): ModelPriceRule[] {
  const rows = database.prepare(`
    SELECT id, model_pattern, input_per_1m, output_per_1m, cache_read_per_1m,
      cache_write_per_1m, reasoning_per_1m, currency, enabled, source, sort_index, updated_at
    FROM model_price_rules
    ORDER BY sort_index ASC, LENGTH(model_pattern) DESC, model_pattern ASC
  `).all() as unknown as ModelPriceRuleRow[]
  return rows.map((row) => ({
    id: row.id,
    modelPattern: row.model_pattern,
    inputPer1M: normalizePrice(row.input_per_1m),
    outputPer1M: normalizePrice(row.output_per_1m),
    cacheReadPer1M: normalizePrice(row.cache_read_per_1m),
    cacheWritePer1M: normalizePrice(row.cache_write_per_1m),
    reasoningPer1M: normalizePrice(row.reasoning_per_1m),
    currency: "CNY",
    enabled: row.enabled === 1,
    source: row.source === "builtin" ? "builtin" : "user",
    sortIndex: Number(row.sort_index),
    updatedAt: row.updated_at,
  } satisfies ModelPriceRule)).sort(compareModelPriceRules)
}

export function replaceModelPriceRules(database: DatabaseSync, rules: readonly ModelPriceRule[]): void {
  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    database.exec("DELETE FROM model_price_rules")
    insertModelPriceRules(database, rules)
    database.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    throw error
  }
}

export function insertModelPriceRules(database: DatabaseSync, rules: readonly ModelPriceRule[]): void {
  const insert = database.prepare(`
    INSERT INTO model_price_rules (
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

function normalizePrice(value: unknown): number {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : 0
}
