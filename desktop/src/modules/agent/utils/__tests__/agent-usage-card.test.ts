import { describe, expect, it } from "vitest"

import {
  buildAgentUsageCardData,
  formatAgentUsageCopyText,
} from "../agent-usage-card"

describe("agent usage card utilities", () => {
  it("builds rows with totals deltas and percentages", () => {
    const data = buildAgentUsageCardData({
      totalUsage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 20,
        reasoningOutputTokens: 10,
        totalTokens: 380,
      },
      turnUsage: {
        input_tokens: 20,
        output_tokens: 5,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 2,
      },
      turnCostCny: 0.18,
      totalCostCny: 1.42,
      estimatedCost: true,
      timestamp: "2026-06-02T06:32:00.000Z",
    })

    expect(data?.rows.map((row) => ({
      key: row.key,
      total: row.total,
      delta: row.delta,
      percent: row.percent,
    }))).toEqual([
      { key: "input", total: 100, delta: 20, percent: 20 },
      { key: "output", total: 50, delta: 5, percent: 10 },
      { key: "cacheRead", total: 200, delta: 40, percent: 20 },
      { key: "cacheWrite", total: 20, delta: 0, percent: 0 },
      { key: "reasoning", total: 10, delta: 2, percent: 20 },
    ])
    expect(data?.turnCostLabel).toBe("¥0.18")
    expect(data?.totalCostLabel).toBe("¥1.42")
  })

  it("omits reasoning when neither total nor turn contains reasoning", () => {
    const data = buildAgentUsageCardData({
      totalUsage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
        totalTokens: 10,
      },
      turnUsage: {
        input_tokens: 1,
        output_tokens: 2,
      },
    })

    expect(data?.rows.map((row) => row.key)).toEqual(["input", "output", "cacheRead", "cacheWrite"])
  })

  it("formats copy text without undefined or NaN", () => {
    const data = buildAgentUsageCardData({
      totalUsage: {
        inputTokens: 10248,
        outputTokens: 3812,
        cacheReadInputTokens: 42180,
        cacheCreationInputTokens: 1216,
        reasoningOutputTokens: 680,
        totalTokens: 58136,
      },
      turnUsage: {
        input_tokens: 2104,
        output_tokens: 846,
        cache_read_input_tokens: 9640,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 180,
      },
      turnCostCny: 0.18,
      totalCostCny: 1.42,
      estimatedCost: true,
    })

    const text = formatAgentUsageCopyText(data)
    expect(text).toContain("用量统计")
    expect(text).toContain("输入 10,248（本轮 +2,104，占累计 21%）")
    expect(text).toContain("价格按当前模型估算")
    expect(text).not.toContain("undefined")
    expect(text).not.toContain("NaN")
  })
})
