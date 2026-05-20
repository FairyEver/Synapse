import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { UsageTodayHourlyChart, UsageTrendChart } from "../shared/components/usage-charts"

const mocks = vi.hoisted(() => ({
  chartOptions: [] as unknown[],
}))

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { readonly option: unknown }) => {
    mocks.chartOptions.push(option)
    return <div data-echarts-chart="" />
  },
}))

beforeEach(() => {
  mocks.chartOptions.length = 0
})

describe("UsageTrendChart", () => {
  it("shows the bucket granularity switch before token mode tabs", () => {
    const html = renderToStaticMarkup(<UsageTrendChart title="Token 趋势" rows={[]} />)

    expect(html).toContain("按天")
    expect(html).toContain("按小时")
    expect(html.indexOf("按小时")).toBeLessThan(html.indexOf("按天"))
    expect(html.indexOf("按天")).toBeLessThan(html.indexOf("全部"))
    expect(html).toContain("新增")
  })
})

describe("UsageTodayHourlyChart", () => {
  it("shows every hour segment label from 01 to 24", () => {
    renderToStaticMarkup(<UsageTodayHourlyChart title="今日时段" rows={Array.from({ length: 24 }, (_, hour) => ({
      bucket: `2026-05-20 ${String(hour).padStart(2, "0")}`,
      tokens: 0,
      estimatedCost: 0,
      requests: 0,
      toolCalls: 0,
      modelBreakdown: [],
    }))} />)

    const option = mocks.chartOptions.at(-1) as {
      readonly xAxis?: {
        readonly data?: string[]
        readonly axisLabel?: { readonly interval?: number }
      }
    }

    expect(option.xAxis?.data).toEqual([
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
      "24",
    ])
    expect(option.xAxis?.axisLabel?.interval).toBe(0)
  })
})
