import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { ComponentProps } from "react"
import { StackedBarChart } from "../stacked-bar-chart"
import type { GraphResult } from "../../hooks/use-token-usage"

vi.mock("echarts-for-react", () => ({
  default: ({ option, opts, className }: { option: unknown; opts?: unknown; className?: string }) => (
    <div
      className={className}
      data-chart-engine="echarts"
      data-option={JSON.stringify(option)}
      data-opts={JSON.stringify(opts)}
    />
  ),
}))

describe("StackedBarChart", () => {
  it("renders token trend with ECharts canvas renderer", () => {
    const html = renderToStaticMarkup(
      <StackedBarChart contributions={[contribution("2026-05-19")]} />,
    )

    expect(html).toContain('data-chart-engine="echarts"')
    expect(html).toContain("&quot;renderer&quot;:&quot;canvas&quot;")
    expect(html).toContain("&quot;type&quot;:&quot;bar&quot;")
    expect(html).toContain("输入")
    expect(html).toContain("输出")
  })
})

function contribution(date: string): ComponentProps<typeof StackedBarChart>["contributions"][number] {
  return {
    date,
    totals: { tokens: 360, cost: 0.12, messages: 3 },
    intensity: 2,
    tokenBreakdown: { input: 120, output: 80, cacheRead: 140, cacheWrite: 20, reasoning: 0 },
    clients: [] as GraphResult["contributions"][number]["clients"],
  }
}
