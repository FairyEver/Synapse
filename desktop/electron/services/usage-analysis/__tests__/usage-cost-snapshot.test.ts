import { describe, expect, it } from "vitest"
import { DEFAULT_MODEL_PRICE_RULES, type ModelPriceRule } from "../../model-price"
import {
  estimateSynapseUsageCostSnapshot,
  usageTokenBreakdownFromRecord,
} from "../usage-cost-snapshot"

const pricedRule: ModelPriceRule = {
  id: "test-model",
  modelPattern: "test-model",
  inputPer1M: 1000,
  outputPer1M: 2000,
  cacheReadPer1M: 10,
  cacheWritePer1M: 100,
  reasoningPer1M: 3000,
  currency: "CNY",
  enabled: true,
  source: "user",
  sortIndex: 0,
  updatedAt: "2026-06-03T00:00:00.000Z",
}

describe("usage cost snapshots", () => {
  it("normalizes snake_case and camelCase usage fields", () => {
    expect(usageTokenBreakdownFromRecord({
      input_tokens: 10,
      outputTokens: 2,
      cacheReadInputTokens: 30,
      cache_creation_input_tokens: 4,
      reasoning_tokens: 1,
    })).toEqual({
      input: 10,
      output: 2,
      cacheRead: 30,
      cacheWrite: 4,
      reasoning: 1,
    })
  })

  it("returns undefined when usage is missing or empty", () => {
    expect(usageTokenBreakdownFromRecord(undefined)).toBeUndefined()
    expect(usageTokenBreakdownFromRecord({})).toBeUndefined()
    expect(estimateSynapseUsageCostSnapshot({
      modelName: "test-model",
      usage: undefined,
      priceRules: [pricedRule],
    })).toBeUndefined()
  })

  it("returns undefined when model is missing", () => {
    expect(estimateSynapseUsageCostSnapshot({
      modelName: "",
      usage: { input_tokens: 1 },
      priceRules: [pricedRule],
    })).toBeUndefined()
  })

  it("estimates CNY cost and category breakdown from price rules", () => {
    expect(estimateSynapseUsageCostSnapshot({
      modelName: "test-model-v1",
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 4,
        reasoning_output_tokens: 1,
      },
      priceRules: [pricedRule],
    })).toEqual({
      modelName: "test-model-v1",
      costCny: 0.0177,
      costBreakdownCny: {
        input: 0.01,
        output: 0.004,
        cacheRead: 0.0003,
        cacheWrite: 0.0004,
        reasoning: 0.003,
      },
      costCurrency: "CNY",
      priceKnown: true,
      estimatedCost: true,
    })
  })

  it("estimates local cost from model-price rules", () => {
    expect(estimateSynapseUsageCostSnapshot({
      modelName: "claude-sonnet-4",
      usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      priceRules: DEFAULT_MODEL_PRICE_RULES,
    })).toMatchObject({
      modelName: "claude-sonnet-4",
      costCny: 129.6,
      costCurrency: "CNY",
      priceKnown: true,
      estimatedCost: true,
    })
  })

  it("returns an unpriced snapshot when no price rule matches", () => {
    expect(estimateSynapseUsageCostSnapshot({
      modelName: "unknown-model",
      usage: { input_tokens: 10, output_tokens: 2 },
      priceRules: [pricedRule],
    })).toEqual({
      modelName: "unknown-model",
      priceKnown: false,
      estimatedCost: false,
    })
  })
})
