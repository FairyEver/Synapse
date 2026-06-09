import { createHash } from "node:crypto"

const MODEL_PRICE_RULE_ID_PATTERN = /^mpr_[a-f0-9]{12}$/

export function isModelPriceRuleId(value: string): boolean {
  return MODEL_PRICE_RULE_ID_PATTERN.test(value)
}

export function normalizeModelPatternKey(value: string): string {
  return value.trim().toLowerCase()
}

export function createModelPriceRuleId(namespace: string, modelPattern: string): string {
  const hash = createHash("sha256")
    .update(`${namespace}:${normalizeModelPatternKey(modelPattern)}`)
    .digest("hex")
    .slice(0, 12)
  return `mpr_${hash}`
}
