import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { OverviewReportView } from "../shared/components/report-views"
import type { ReportState, UsageOverviewReport } from "../shared/types"

describe("usage analysis report views", () => {
  it("keeps existing overview content visible while reloading", () => {
    const html = renderToStaticMarkup(
      <OverviewReportView
        state={state(overviewReport(), true)}
        trendBucket="day"
        onTrendBucketChange={() => undefined}
      />,
    )

    expect(html).toContain("Token 趋势")
    expect(html).toContain("新增 Token")
    expect(html).toContain("缓存读")
    expect(html).toContain("按小时")
  })

  it("marks unknown model prices as unpriced", () => {
    const report = overviewReport()
    const html = renderToStaticMarkup(
      <OverviewReportView
        state={state({
          ...report,
          totals: {
            ...report.totals,
            pricedTokens: 0,
            unpricedTokens: report.totals.tokens,
            estimatedCost: 0,
          },
        }, false)}
        trendBucket="day"
        onTrendBucketChange={() => undefined}
      />,
    )

    expect(html).toContain("未定价")
  })
})

function state<T>(data: T, loading: boolean): ReportState<T> {
  return {
    data,
    loading,
    error: null,
    reload: async () => undefined,
  }
}

function overviewReport(): UsageOverviewReport {
  return {
    generatedAt: "2026-05-20T00:00:00.000Z",
    totals: {
      tokens: 10,
      pricedTokens: 10,
      unpricedTokens: 0,
      estimatedCost: 0.01,
      requests: 1,
      conversations: 1,
      toolCalls: 0,
      activeDays: 1,
    },
    tokenBreakdown: {
      input: 6,
      output: 4,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    },
    costBreakdown: {
      input: 0.006,
      output: 0.004,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    },
    topModels: [],
    topProjects: [],
    topTools: [],
    trend: [{
      bucket: "2026-05-20",
      tokens: 10,
      pricedTokens: 10,
      unpricedTokens: 0,
      estimatedCost: 0.01,
      requests: 1,
      conversations: 1,
      toolCalls: 0,
      dominantModel: "claude-opus-4.6",
      modelBreakdown: [{
        model: "claude-opus-4.6",
        tokens: 10,
        input: 6,
        output: 4,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
      }],
    }],
  }
}
