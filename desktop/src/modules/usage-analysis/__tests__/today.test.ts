import { describe, expect, it } from "vitest"
import {
  buildTodayMetricRows,
  buildTodayTimeRows,
  buildTodayModelStructureRows,
  buildTodayTokenStructureRows,
  calculateNewTokens,
  describeDominantTokenComponent,
  describeTokenStructure,
  formatCacheReadShare,
  formatTodayHour,
  getRecentHourBucket,
} from "../shared/today"
import type { UsageModelRow, UsageOverviewReport, UsageTimeBucket } from "../shared/types"

const overview: UsageOverviewReport = {
  generatedAt: "2026-05-20T04:00:00.000Z",
  totals: {
    tokens: 1200,
    pricedTokens: 1200,
    unpricedTokens: 0,
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
    pricedTokens: 400,
    unpricedTokens: 0,
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

    expect(metrics.map((metric) => metric.label)).toEqual(["今日 Token", "新增 Token", "缓存读", "最近 1 小时"])
    expect(metrics[0].subValue).toBe("US$1.20")
    expect(metrics[1]).toMatchObject({ value: "600", subValue: "不含缓存读" })
    expect(metrics[2]).toMatchObject({ value: "600", subValue: "50%" })
    expect(metrics[3].value).toBe("400")
    expect(metrics[3].subValue).toBe("4 请求 · 新增 200")
  })

  it("formats empty cache and recent-hour metric states", () => {
    expect(buildTodayMetricRows({ ...overview, tokenBreakdown: { ...overview.tokenBreakdown, cacheRead: 0 } }, [], new Date(2026, 4, 20, 12, 0, 0))[2]).toMatchObject({
      value: "-",
      subValue: "-",
    })
    expect(buildTodayMetricRows(overview, [], new Date(2026, 4, 20, 0, 10, 0))[3]).toMatchObject({ value: "-" })
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

  it("does not repeat cache read when it is already dominant", () => {
    expect(describeTokenStructure({
      input: 100,
      output: 50,
      cacheRead: 350,
      cacheWrite: 0,
      reasoning: 0,
    })).toBe("缓存读 70%")
    expect(describeTokenStructure({
      input: 300,
      output: 100,
      cacheRead: 100,
      cacheWrite: 0,
      reasoning: 0,
    })).toBe("输入 60% · 缓存读 20%")
  })

  it("calculates non-cache and cache-read share", () => {
    expect(calculateNewTokens(overview.tokenBreakdown)).toBe(600)
    expect(formatCacheReadShare(overview.tokenBreakdown)).toBe("50%")
  })

  it("returns the last active hourly bucket as recent hour", () => {
    expect(getRecentHourBucket(timeRows)?.bucket).toBe("2026-05-20 09")
  })

  it("fills today time rows from 00:00 to 23:00", () => {
    const rows = buildTodayTimeRows([
      {
        ...emptyHour("2026-05-20 09"),
        tokens: 400,
        requests: 4,
      },
      {
        ...emptyHour("2026-05-20 12"),
        tokens: 800,
        requests: 8,
      },
    ], "2026-05-20T12:30:00.000Z")

    expect(rows).toHaveLength(24)
    expect(rows[0]?.bucket).toBe("2026-05-20 00")
    expect(rows.at(-1)?.bucket).toBe("2026-05-20 23")
    expect(rows.map((row) => row.bucket.slice(11))).toEqual([
      "00",
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
      "22",
      "23",
    ])
    expect(rows[9]?.tokens).toBe(400)
    expect(rows[12]?.requests).toBe(8)
    expect(rows[10]).toMatchObject({ tokens: 0, requests: 0, modelBreakdown: [] })
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
    pricedTokens: 0,
    unpricedTokens: 0,
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
    pricedTokens: tokens,
    unpricedTokens: 0,
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
