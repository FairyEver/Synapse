import { describe, expect, it } from "vitest"
import { estimateUsageCost } from "../pricing"

describe("usage analysis pricing", () => {
  it("estimates OpenAI-style cached input and reasoning costs", () => {
    const cost = estimateUsageCost("codex", "gpt-5.5", {
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
    const cost = estimateUsageCost("cc", "claude-opus-4.6", {
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

  it("returns zero cost for unknown models", () => {
    expect(estimateUsageCost("cc", "unknown-model", {
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
    })
  })
})
