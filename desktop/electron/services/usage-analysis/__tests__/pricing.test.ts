import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initUsageAnalysisSchema } from "../db-schema"
import {
  DEFAULT_USAGE_PRICE_RULES,
  createUsagePriceRule,
  deleteUsagePriceRule,
  estimateUsageCost,
  findUsagePriceRuleForModel,
  getUsagePriceRule,
  listUsagePriceRules,
  normalizeUsagePriceRules,
  setUsagePriceRuleEnabled,
  updateUsagePriceRule,
} from "../pricing"

describe("usage analysis pricing", () => {
  it("matches prices by model pattern without provider-specific rules", () => {
    const rules = normalizeUsagePriceRules([{
      modelPattern: "shared-model",
      inputPer1M: 2,
      outputPer1M: 6,
      cacheReadPer1M: 0.5,
      cacheWritePer1M: 3,
      reasoningPer1M: 6,
    }])

    const cost = estimateUsageCost("shared-model", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
      reasoning: 1_000_000,
    }, rules)

    expect(cost.priceKnown).toBe(true)
    expect(cost.total).toBe(17.5)
  })

  it("estimates OpenAI-style cached input and reasoning costs", () => {
    const cost = estimateUsageCost("gpt-5.5", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 0,
      reasoning: 500_000,
    })

    expect(cost.input).toBeGreaterThan(0)
    expect(cost.cacheRead).toBeGreaterThan(0)
    expect(cost.cacheWrite).toBe(0)
    expect(cost.reasoning).toBeGreaterThan(0)
    expect(cost.total).toBeCloseTo(cost.input + cost.output + cost.cacheRead + cost.reasoning, 6)
  })

  it("estimates Anthropic-style cache creation costs", () => {
    const cost = estimateUsageCost("claude-opus-4.6", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
      reasoning: 0,
    })

    expect(cost.input).toBeGreaterThan(0)
    expect(cost.output).toBeGreaterThan(cost.input)
    expect(cost.cacheRead).toBeGreaterThan(0)
    expect(cost.cacheWrite).toBeGreaterThan(cost.input)
    expect(cost.total).toBeCloseTo(cost.input + cost.output + cost.cacheRead + cost.cacheWrite, 6)
  })

  it("marks unknown models as unpriced", () => {
    expect(estimateUsageCost("unknown-model", {
      input: 1,
      output: 1,
      cacheRead: 1,
      cacheWrite: 1,
      reasoning: 1,
    })).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
      priceKnown: false,
    })
  })

  it("seeds new databases with CNY default price rules", () => {
    const db = new DatabaseSync(":memory:")
    initUsageAnalysisSchema(db)

    const rules = listUsagePriceRules(db)
    expect(rules.find((rule) => rule.modelPattern === "claude-sonnet-4")).toMatchObject({
      inputPer1M: 21.6,
      outputPer1M: 108,
      cacheReadPer1M: 2.16,
      cacheWritePer1M: 27,
      reasoningPer1M: 108,
      currency: "CNY",
    })
    expect(db.prepare("SELECT value FROM usage_pricing_meta WHERE key = ?").get("cost_currency_migrated_to_cny_v1")).toBeTruthy()
    db.close()
  })

  it("keeps default in-memory rules in CNY", () => {
    expect(DEFAULT_USAGE_PRICE_RULES.find((rule) => rule.modelPattern === "claude-sonnet-4")).toMatchObject({
      inputPer1M: 21.6,
      outputPer1M: 108,
      cacheReadPer1M: 2.16,
      cacheWritePer1M: 27,
      reasoningPer1M: 108,
      currency: "CNY",
    })
  })

  it("creates updates enables disables and deletes model price rules by id", () => {
    const db = new DatabaseSync(":memory:")
    initUsageAnalysisSchema(db)

    const created = createUsagePriceRule(db, {
      modelPattern: "local-model",
      inputPer1M: 14.4,
      outputPer1M: 57.6,
    })
    expect(created).toMatchObject({
      modelPattern: "local-model",
      inputPer1M: 14.4,
      outputPer1M: 57.6,
      cacheReadPer1M: 0,
      cacheWritePer1M: 0,
      reasoningPer1M: 0,
      currency: "CNY",
      enabled: true,
      source: "user",
    })

    const updated = updateUsagePriceRule(db, created.id, { outputPer1M: 72 })
    expect(updated).toMatchObject({
      id: created.id,
      modelPattern: "local-model",
      inputPer1M: 14.4,
      outputPer1M: 72,
    })

    const disabled = setUsagePriceRuleEnabled(db, created.id, false)
    expect(disabled.enabled).toBe(false)
    expect(findUsagePriceRuleForModel("local-model", listUsagePriceRules(db))).toBeNull()

    const enabled = setUsagePriceRuleEnabled(db, created.id, true)
    expect(enabled.enabled).toBe(true)
    expect(findUsagePriceRuleForModel("local-model", listUsagePriceRules(db))?.id).toBe(created.id)

    expect(deleteUsagePriceRule(db, created.id)).toEqual({ deleted: true, ruleId: created.id })
    expect(getUsagePriceRule(db, created.id)).toBeNull()
    db.close()
  })

  it("throws clear errors for missing model price rule ids", () => {
    const db = new DatabaseSync(":memory:")
    initUsageAnalysisSchema(db)

    expect(() => updateUsagePriceRule(db, "missing-rule", { inputPer1M: 1 })).toThrow(/Model price rule not found/)
    expect(() => setUsagePriceRuleEnabled(db, "missing-rule", false)).toThrow(/Model price rule not found/)
    expect(() => deleteUsagePriceRule(db, "missing-rule")).toThrow(/Model price rule not found/)
    db.close()
  })
})
