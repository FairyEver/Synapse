import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { TodayReportView } from "../shared/components/today-report-view"
import type { ReportState, UsageModelRow, UsageOverviewReport, UsageTimeBucket } from "../shared/types"

describe("TodayReportView", () => {
  it("renders today metrics, charts, and rhythm table without ranking labels", () => {
    const html = renderToStaticMarkup(
      <TodayReportView
        overviewState={state(overviewReport)}
        timeState={state(timeRows)}
        modelsState={state(modelRows)}
      />,
    )

    expect(html).toContain("今日 Token")
    expect(html).toContain("最近 1 小时")
    expect(html).toContain("今日时段")
    expect(html).toContain("Token 结构")
    expect(html).toContain("模型结构")
    expect(html).toContain("今日节奏")
    expect(html).toContain("grid-cols-4")
    expect(html).not.toContain("lg:grid-cols-4")
    expect(html).not.toContain("工具调用排行")
    expect(html).not.toContain("项目 Token 排行")
  })
})

function state<T>(data: T): ReportState<T> {
  return {
    data,
    loading: false,
    error: null,
    reload: async () => undefined,
  }
}

const overviewReport: UsageOverviewReport = {
  generatedAt: "2026-05-20T10:30:00.000Z",
  totals: {
    tokens: 1500,
    estimatedCost: 0.42,
    requests: 5,
    conversations: 2,
    toolCalls: 0,
    activeDays: 1,
  },
  tokenBreakdown: {
    input: 600,
    output: 500,
    cacheRead: 250,
    cacheWrite: 100,
    reasoning: 50,
  },
  costBreakdown: {
    input: 0.12,
    output: 0.18,
    cacheRead: 0.04,
    cacheWrite: 0.05,
    reasoning: 0.03,
  },
  topModels: [],
  topProjects: [],
  topTools: [],
  trend: [],
}

const timeRows: UsageTimeBucket[] = [
  {
    bucket: "2026-05-20 09",
    tokens: 1000,
    estimatedCost: 0.3,
    requests: 3,
    conversations: 1,
    toolCalls: 0,
    dominantModel: "claude-sonnet-4.5",
    modelBreakdown: [
      {
        model: "claude-sonnet-4.5",
        tokens: 1000,
        input: 400,
        output: 350,
        cacheRead: 150,
        cacheWrite: 80,
        reasoning: 20,
      },
    ],
  },
  {
    bucket: "2026-05-20 10",
    tokens: 500,
    estimatedCost: 0.12,
    requests: 2,
    conversations: 1,
    toolCalls: 0,
    dominantModel: "claude-haiku-4.5",
    modelBreakdown: [
      {
        model: "claude-haiku-4.5",
        tokens: 500,
        input: 200,
        output: 150,
        cacheRead: 100,
        cacheWrite: 20,
        reasoning: 30,
      },
    ],
  },
]

const modelRows: UsageModelRow[] = [
  {
    model: "claude-sonnet-4.5",
    provider: "anthropic",
    tokens: 1000,
    estimatedCost: 0.3,
    input: 400,
    output: 350,
    cacheRead: 150,
    cacheWrite: 80,
    reasoning: 20,
    requests: 3,
    averageTokensPerRequest: 333.33,
  },
  {
    model: "claude-haiku-4.5",
    provider: "anthropic",
    tokens: 500,
    estimatedCost: 0.12,
    input: 200,
    output: 150,
    cacheRead: 100,
    cacheWrite: 20,
    reasoning: 30,
    requests: 2,
    averageTokensPerRequest: 250,
  },
]
