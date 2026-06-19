import { describe, expect, it } from "vitest"

import { findModelPriceRuleForModel, normalizeModelPriceRules } from "../matching"

describe("model price matching", () => {
  it("prefers a more specific substring match over an earlier generic rule", () => {
    const rules = normalizeModelPriceRules([
      { modelPattern: "qwen-plus", inputPer1M: 4.8, outputPer1M: 48, sortIndex: 0 },
      { modelPattern: "qwen-plus-2025-07-14", inputPer1M: 0.8, outputPer1M: 2, sortIndex: 1 },
    ])

    const matchedRule = findModelPriceRuleForModel("qwen-plus-2025-07-14", rules)

    expect(matchedRule?.modelPattern).toBe("qwen-plus-2025-07-14")
  })
})
