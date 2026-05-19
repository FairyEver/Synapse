import { describe, expect, it } from "vitest"
import {
  buildTodayMetricRows,
  buildTodayModelStructureRows,
  buildTodayTokenStructureRows,
  describeDominantTokenComponent,
  formatTodayHour,
  getRecentHourBucket,
} from "../shared/today"
import type { UsageModelRow, UsageOverviewReport, UsageTimeBucket } from "../shared/types"

const overview: UsageOverviewReport = {
  generatedAt: "2026-05-20T04:00:00.000Z",
  totals: {
    tokens: 1200,
    estimatedCost: 1.2,
    requests: 12,
    conversations: 3,
    toolCalls: 0,
    activeDays: 1,
  },
  tokenBreakdown: {
    input: 300,
    output: 200,
    cacheRead: 600,
    cacheWrite: 100,
    reasoning: 0,
  },
  costBreakdown: {
    input: 0.2,
    output: 0.3,
    cacheRead: 0.1,
    cacheWrite: 0.6,
    reasoning: 0,
  },
  topModels: [],
  topProjects: [],
  topTools: [],
  trend: [],
}

const timeRows: UsageTimeBucket[] = [
  emptyHour("2026-05-20 08"),
  {
    bucket: "2026-05-20 09",
    tokens: 400,
    estimatedCost: 0.4,
    requests: 4,
    conversations: 1,
    toolCalls: 0,
    dominantModel: "claude-opus-4.6",
    modelBreakdown: [{
      model: "claude-opus-4.6",
      tokens: 400,
      input: 100,
      output: 100,
      cacheRead: 200,
      cacheWrite: 0,
      reasoning: 0,
    }],
  },
  emptyHour("2026-05-20 10"),
]

describe("today usage helpers", () => {
  it("builds today status metrics", () => {
    const metrics = buildTodayMetricRows(overview, timeRows, new Date(2026, 4, 20, 12, 0, 0))

    expect(metrics.map((metric) => metric.label)).toEqual(["今日 Token", "今日费用", "最近 1 小时", "今日预计"])
    expect(metrics[2].value).toBe("400")
    expect(metrics[2].subValue).toBe("4 请求")
    expect(metrics[3].value).not.toBe("-")
    expect(metrics[3].subValue).not.toBe("-")
  })

  it("hides today projection when usage is zero or the day just started", () => {
    expect(buildTodayMetricRows({ ...overview, totals: { ...overview.totals, tokens: 0, estimatedCost: 0 } }, [], new Date(2026, 4, 20, 12, 0, 0))[3]).toMatchObject({
      value: "-",
      subValue: "-",
    })
    expect(buildTodayMetricRows(overview, timeRows, new Date(2026, 4, 20, 0, 10, 0))[3]).toMatchObject({
      value: "-",
      subValue: "-",
    })
  })

  it("builds token structure rows in fixed label order", () => {
    expect(buildTodayTokenStructureRows(overview.tokenBreakdown)).toEqual([
      { label: "输入", value: 300 },
      { label: "输出", value: 200 },
      { label: "缓存读", value: 600 },
      { label: "缓存写", value: 100 },
      { label: "推理", value: 0 },
    ])
  })

  it("describes the dominant token component", () => {
    expect(describeDominantTokenComponent({
      input: 100,
      output: 50,
      cacheRead: 350,
      cacheWrite: 0,
      reasoning: 0,
    })).toBe("缓存读 70%")
  })

  it("returns the last active hourly bucket as recent hour", () => {
    expect(getRecentHourBucket(timeRows)?.bucket).toBe("2026-05-20 09")
  })

  it("limits model structure and groups the remainder", () => {
    const rows = buildTodayModelStructureRows([
      modelRow("b", 90),
      modelRow("f", 50),
      modelRow("a", 100),
      modelRow("e", 60),
      modelRow("d", 70),
      modelRow("c", 80),
    ])

    expect(rows).toEqual([
      { label: "a", value: 100 },
      { label: "b", value: 90 },
      { label: "c", value: 80 },
      { label: "d", value: 70 },
      { label: "e", value: 60 },
      { label: "其他", value: 50 },
    ])
  })

  it("formats today hour buckets for display", () => {
    expect(formatTodayHour("2026-05-20 09")).toBe("09:00")
  })
})

function emptyHour(bucket: string): UsageTimeBucket {
  return {
    bucket,
    tokens: 0,
    estimatedCost: 0,
    requests: 0,
    conversations: 0,
    toolCalls: 0,
    dominantModel: "",
    modelBreakdown: [],
  }
}

function modelRow(model: string, tokens: number): UsageModelRow {
  return {
    model,
    provider: "",
    tokens,
    estimatedCost: 0,
    input: tokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    requests: 1,
    averageTokensPerRequest: tokens,
  }
}
