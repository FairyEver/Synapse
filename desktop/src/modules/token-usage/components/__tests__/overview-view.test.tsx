import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { OverviewView } from "../overview-view"
import type { GraphResult } from "../../hooks/use-token-usage"

function graphResult(): GraphResult {
  const contribution: GraphResult["contributions"][number] = {
    date: "2026-05-19",
    totals: { tokens: 360, cost: 0.12, messages: 3 },
    intensity: 2,
    tokenBreakdown: { input: 120, output: 80, cacheRead: 140, cacheWrite: 20, reasoning: 0 },
    clients: [
      {
        client: "codex",
        modelId: "gpt-test",
        providerId: "openai",
        tokens: { input: 120, output: 80, cacheRead: 140, cacheWrite: 20, reasoning: 0 },
        cost: 0.12,
        messages: 3,
      },
    ],
  }

  return {
    meta: { generatedAt: new Date().toISOString(), processingTimeMs: 0 },
    summary: {
      totalTokens: contribution.totals.tokens,
      totalCost: contribution.totals.cost,
      totalDays: 1,
      activeDays: 1,
      averagePerDay: contribution.totals.tokens,
      maxCostInSingleDay: contribution.totals.cost,
      clients: ["codex"],
      models: ["gpt-test"],
    },
    years: [],
    contributions: [contribution],
  }
}

describe("OverviewView", () => {
  it("renders token breakdown chart without the hot model list", () => {
    const html = renderToStaticMarkup(<OverviewView graphResult={graphResult()} />)

    expect(html).toContain("输入")
    expect(html).toContain("输出")
    expect(html).not.toContain("热门模型")
    expect(html).not.toContain("gpt-test")
  })
})
