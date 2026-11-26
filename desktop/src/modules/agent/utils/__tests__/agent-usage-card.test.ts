import { describe, expect, it } from "vitest"

import {
  buildAgentUsageCardData,
  formatAgentUsageCopyText,
} from "../agent-usage-card"

describe("agent usage card utilities", () => {
  it("builds rows with totals deltas and percentages without any prices", () => {
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
      timestamp: "2026-06-02T06:32:00.000Z",
    })

    expect(data?.rows).toEqual([
      {
        key: "input",
        label: "输入",
        total: 100,
        delta: 20,
        percent: 20,
        totalTooltip: "累计输入 token：100",
        deltaTooltip: "本轮新增输入 token：20",
      },
      {
        key: "output",
        label: "输出",
        total: 50,
        delta: 5,
        percent: 10,
        totalTooltip: "累计输出 token：50",
        deltaTooltip: "本轮新增输出 token：5",
      },
      {
        key: "cacheRead",
        label: "缓存读",
        total: 200,
        delta: 40,
        percent: 20,
        totalTooltip: "累计缓存读 token：200",
        deltaTooltip: "本轮新增缓存读 token：40",
      },
      {
        key: "cacheWrite",
        label: "缓存写",
        total: 20,
        delta: 0,
        percent: 0,
        totalTooltip: "累计缓存写 token：20",
        deltaTooltip: "本轮新增缓存写 token：0",
      },
      {
        key: "reasoning",
        label: "思考",
        total: 10,
        delta: 2,
        percent: 20,
        totalTooltip: "累计思考 token：10",
        deltaTooltip: "本轮新增思考 token：2",
      },
    ])
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

  it("builds tooltips for missing turn delta without any pricing metadata", () => {
    const data = buildAgentUsageCardData({
      totalUsage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 3,
      },
    })

    expect(data?.rows[0]?.totalTooltip).toBe("累计输入 token：1")
    expect(data?.rows[0]?.deltaTooltip).toBe("本轮输入 token 增量暂无数据")
    expect(formatAgentUsageCopyText(data)).not.toContain("费用")
    expect(formatAgentUsageCopyText(data)).not.toContain("价格")
  })

  it("formats copy text with pure token usage and without prices, undefined, or NaN", () => {
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
    })

    const text = formatAgentUsageCopyText(data)
    expect(text).toContain("用量统计")
    expect(text).toContain("输入 10,248（本轮 +2,104，占累计 21%）")
    expect(text).not.toContain("费用")
    expect(text).not.toContain("价格")
    expect(text).not.toContain("¥")
    expect(text).not.toContain("$")
    expect(text).not.toContain("undefined")
    expect(text).not.toContain("NaN")
  })
})
