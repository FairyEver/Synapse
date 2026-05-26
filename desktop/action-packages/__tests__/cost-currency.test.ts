import { describe, expect, it } from "vitest"
import {
  SYNAPSE_COST_CURRENCY,
  USD_TO_CNY_RATE,
  formatSynapseCost,
  normalizeCostCny,
  resolveSynapseCostCny,
  usdToCny,
} from "../shared/cost-currency"

describe("cost currency helpers", () => {
  it("converts legacy USD costs to CNY with the fixed rate", () => {
    expect(SYNAPSE_COST_CURRENCY).toBe("CNY")
    expect(USD_TO_CNY_RATE).toBe(7.2)
    expect(usdToCny(0.01)).toBeCloseTo(0.072, 6)
  })

  it("normalizes finite non-negative CNY costs", () => {
    expect(normalizeCostCny(1.23)).toBe(1.23)
    expect(normalizeCostCny(-1)).toBeUndefined()
    expect(normalizeCostCny(Number.NaN)).toBeUndefined()
    expect(normalizeCostCny("1")).toBeUndefined()
  })

  it("prefers CNY snapshots and falls back to legacy USD values", () => {
    expect(resolveSynapseCostCny({ costCny: 5, costUsd: 1 })).toBe(5)
    expect(resolveSynapseCostCny({ costUsd: 1 })).toBe(7.2)
    expect(resolveSynapseCostCny({})).toBeUndefined()
  })

  it("formats CNY values for user-facing cost display", () => {
    expect(formatSynapseCost(7.2)).toContain("¥")
    expect(formatSynapseCost(7.2)).toContain("7.20")
  })
})
