import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DetailsReportView, OverviewReportView, ProjectsReportView } from "../shared/components/report-views"
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

  it("formats overview costs as RMB", () => {
    const html = renderToStaticMarkup(
      <OverviewReportView
        state={state(overviewReport(), false)}
        trendBucket="day"
        onTrendBucketChange={() => undefined}
      />,
    )

    expect(html).toContain("¥0.01")
    expect(html).not.toContain("US$")
  })

  it("keeps hyphenated Claude project labels intact", () => {
    const report = {
      ...overviewReport(),
      topProjects: [{
        workspaceKey: "-Users-dev-front-end-app-v2",
        workspaceLabel: "-Users-dev-front-end-app-v2",
        tokens: 10,
        pricedTokens: 10,
        unpricedTokens: 0,
        estimatedCost: 0.01,
        requests: 1,
        sessions: 1,
        toolCalls: 0,
        lastUsedAt: "2026-05-20T00:00:00.000Z",
      }],
    }
    const html = renderToStaticMarkup(
      <ProjectsReportView state={state(report.topProjects, false)} />,
    )

    expect(html).toContain("dev-front-end-app-v2")
    expect(html).not.toContain("front/end/app/v2")
  })

  it("renders detail rows with an open conversation action", () => {
    const html = renderToStaticMarkup(
      <DetailsReportView
        state={state([{
          id: "usage-1",
          usageEventId: "usage-1",
          timestamp: "2026-05-27T01:00:00.000Z",
          timestampMs: 1779843600000,
          sessionId: "session-1",
          workspaceLabel: "/repo",
          model: "claude-opus-4.6",
          tokens: 15,
          pricedTokens: 15,
          unpricedTokens: 0,
          estimatedCost: 0.01,
          tokenBreakdown: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
          toolCalls: 1,
        }], false)}
        onOpenConversation={() => undefined}
      />,
    )

    expect(html).toContain("打开对话")
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
