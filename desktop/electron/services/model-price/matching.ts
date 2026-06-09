import { createHash } from "node:crypto"
import { SYNAPSE_COST_CURRENCY } from "../../../action-packages/shared/cost-currency"
import type { EstimatedModelUsageCost, ModelPriceRule, ModelPriceRuleInput, ModelUsageTokenBreakdown } from "./types"

const COST_FRACTION_DIGITS = 6

export function roundModelUsageCost(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Number(value.toFixed(COST_FRACTION_DIGITS))
}

export function normalizeModelPriceRules(inputs: readonly ModelPriceRuleInput[]): ModelPriceRule[] {
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
        source: input.source === "builtin" ? "builtin" : "user",
        sortIndex: Number.isFinite(Number(input.sortIndex)) ? Number(input.sortIndex) : index,
        updatedAt: input.updatedAt || now,
      } satisfies ModelPriceRule
    })
    .filter((rule): rule is ModelPriceRule => rule !== null)
    .sort(compareModelPriceRules)
}

export function compareModelPriceRules(a: ModelPriceRule, b: ModelPriceRule): number {
  return a.sortIndex - b.sortIndex
    || b.modelPattern.length - a.modelPattern.length
    || a.modelPattern.localeCompare(b.modelPattern)
}

export function findModelPriceRuleForModel(model: string, rules: readonly ModelPriceRule[]): ModelPriceRule | null {
  return rules.filter((rule) => rule.enabled).find((rule) => matchesModelPattern(model, rule.modelPattern)) ?? null
}

export function estimateModelUsageCost(
  model: string,
  tokens: ModelUsageTokenBreakdown,
  rules: readonly ModelPriceRule[],
): EstimatedModelUsageCost {
  const rule = findModelPriceRuleForModel(model, rules)
  if (!rule) {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
      priceKnown: false,
      currency: SYNAPSE_COST_CURRENCY,
    }
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
    total: roundModelUsageCost(input + output + cacheRead + cacheWrite + reasoning),
    priceKnown: true,
    currency: SYNAPSE_COST_CURRENCY,
    matchedRuleId: rule.id,
    matchedRulePattern: rule.modelPattern,
  }
}

export function hashModelPriceRules(rules: readonly ModelPriceRule[]): string {
  return createHash("sha256")
    .update(JSON.stringify(rules.map((rule) => ({
      id: rule.id,
      modelPattern: rule.modelPattern,
      inputPer1M: rule.inputPer1M,
      outputPer1M: rule.outputPer1M,
      cacheReadPer1M: rule.cacheReadPer1M,
      cacheWritePer1M: rule.cacheWritePer1M,
      reasoningPer1M: rule.reasoningPer1M,
      currency: rule.currency,
      enabled: rule.enabled,
      sortIndex: rule.sortIndex,
    }))))
    .digest("hex")
}

function cost(tokens: number, per1M: number): number {
  if (per1M <= 0 || tokens <= 0) return 0
  return roundModelUsageCost((tokens / 1_000_000) * per1M)
}

function normalizePrice(value: unknown): number {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : 0
}

function normalizeRuleId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || "price-rule"
}

function makeRuleId(input: ModelPriceRuleInput, index: number, usedIds: Set<string>): string {
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
