import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { StatsView } from "../stats-view"
import { toLocalDateString } from "../../lib/format"
import type { GraphResult } from "../../hooks/use-token-usage"

function dateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toLocalDateString(date)
}

function contribution(date: string, tokens = 100): GraphResult["contributions"][number] {
  return {
    date,
    totals: { tokens, cost: 0.01, messages: 1 },
    intensity: 1,
    tokenBreakdown: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    clients: [
      {
        client: "codex",
        modelId: "gpt-test",
        providerId: "openai",
        tokens: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
        cost: 0.01,
        messages: 1,
      },
    ],
  }
}

function graphResult(contributions: GraphResult["contributions"]): GraphResult {
  return {
    meta: { generatedAt: new Date().toISOString(), processingTimeMs: 0 },
    summary: {
      totalTokens: contributions.reduce((sum, item) => sum + item.totals.tokens, 0),
      totalCost: contributions.reduce((sum, item) => sum + item.totals.cost, 0),
      totalDays: contributions.length,
      activeDays: contributions.length,
      averagePerDay: contributions.length > 0
        ? contributions.reduce((sum, item) => sum + item.totals.tokens, 0) / contributions.length
        : 0,
      maxCostInSingleDay: Math.max(0, ...contributions.map((item) => item.totals.cost)),
      clients: ["codex"],
      models: ["gpt-test"],
    },
    years: [],
    contributions,
  }
}

function expectStatValue(html: string, label: string, value: string): void {
  const index = html.indexOf(`>${label}<`)
  expect(index).toBeGreaterThanOrEqual(0)
  expect(html.slice(index, index + 180)).toContain(`>${value}<`)
}

describe("StatsView", () => {
  it("does not count non-adjacent contribution rows as a streak", () => {
    const html = renderToStaticMarkup(
      <StatsView
        graphResult={graphResult([
          contribution(dateOffset(-9)),
          contribution(dateOffset(0)),
        ])}
      />,
    )

    expectStatValue(html, "当前连续", "1 天")
    expectStatValue(html, "最长连续", "1 天")
  })

  it("reports no current streak when the latest contribution is stale", () => {
    const html = renderToStaticMarkup(
      <StatsView
        graphResult={graphResult([
          contribution(dateOffset(-3)),
          contribution(dateOffset(-2)),
        ])}
      />,
    )

    expectStatValue(html, "当前连续", "0 天")
    expectStatValue(html, "最长连续", "2 天")
  })
})
