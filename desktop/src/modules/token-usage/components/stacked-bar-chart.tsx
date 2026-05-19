import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"
import { formatTokens } from "../lib/format"
import { useEChartsThemeTokens } from "../lib/echarts-theme"
import type { GraphResult } from "../hooks/use-token-usage"

type Contribution = GraphResult["contributions"][number]
type ChartKey = "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning"

interface StackedBarChartProps {
  contributions: Contribution[]
}

const TOKEN_SERIES: { key: ChartKey; label: string; className: string }[] = [
  { key: "input", label: "输入", className: "bg-chart-1" },
  { key: "output", label: "输出", className: "bg-chart-2" },
  { key: "cacheRead", label: "缓存读", className: "bg-chart-3" },
  { key: "cacheWrite", label: "缓存写", className: "bg-chart-4" },
  { key: "reasoning", label: "思考", className: "bg-chart-5" },
]

export function StackedBarChart({ contributions }: StackedBarChartProps) {
  const theme = useEChartsThemeTokens()
  const chartData = useMemo(() => contributions
    .filter((c) => c.totals.tokens > 0)
    .map((c) => ({
      date: formatContributionLabel(c.date),
      total: c.totals.tokens,
      input: c.tokenBreakdown.input,
      output: c.tokenBreakdown.output,
      cacheRead: c.tokenBreakdown.cacheRead,
      cacheWrite: c.tokenBreakdown.cacheWrite,
      reasoning: c.tokenBreakdown.reasoning,
    })), [contributions])

  const series = useMemo(() => {
    const activeSeries = TOKEN_SERIES.filter((item) =>
      chartData.some((row) => row[item.key] > 0),
    )
    return activeSeries.length > 0 ? activeSeries : TOKEN_SERIES.slice(0, 2)
  }, [chartData])
  const option = useMemo<EChartsOption>(() => ({
    color: series.map((_, index) => theme.chart[index] ?? theme.primary),
    animation: false,
    grid: { top: 16, right: 8, bottom: 24, left: 56 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: formatAxisTooltip,
      confine: true,
    },
    xAxis: {
      type: "category",
      data: chartData.map((item) => item.date),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.mutedForeground, fontSize: 12 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.border } },
      axisLabel: {
        color: theme.mutedForeground,
        fontSize: 12,
        formatter: (value: number) => formatTokens(value),
      },
    },
    series: series.map((item, index) => ({
      name: item.label,
      type: "bar",
      stack: "tokens",
      data: chartData.map((row) => row[item.key]),
      barMaxWidth: 44,
      itemStyle: index === series.length - 1
        ? { borderRadius: [4, 4, 0, 0] }
        : undefined,
      emphasis: { focus: "series" },
    })),
  }), [chartData, series, theme])

  if (chartData.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-md border text-sm text-muted-foreground">
        暂无趋势数据
      </div>
    )
  }

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {series.map((item) => (
          <div key={item.key} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${item.className}`} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <ReactECharts
        className="h-80 w-full"
        option={option}
        opts={{ renderer: "canvas" }}
        notMerge
        lazyUpdate
      />
    </div>
  )
}

interface TooltipParam {
  axisValueLabel?: string
  marker?: string
  seriesName?: string
  value?: unknown
}

function isTooltipParam(value: unknown): value is TooltipParam {
  return typeof value === "object" && value !== null
}

function formatAxisTooltip(params: unknown): string {
  const items = (Array.isArray(params) ? params : [params]).filter(isTooltipParam)
  const rows = items
    .map((item) => ({
      label: item.seriesName ?? "",
      marker: item.marker ?? "",
      value: Number(item.value) || 0,
    }))
    .filter((item) => item.value > 0)
  const total = rows.reduce((sum, item) => sum + item.value, 0)
  const title = items[0]?.axisValueLabel ?? ""

  return [
    `<div>${title} <span>${formatTokens(total)}</span></div>`,
    ...rows.map((item) => `${item.marker}${item.label}: ${formatTokens(item.value)}`),
  ].join("<br/>")
}

function formatContributionLabel(date: string): string {
  if (date.length >= 13) {
    const day = date.slice(5, 10)
    const hour = date.slice(11, 13)
    if (/^\d{2}$/.test(hour)) {
      return `${day} ${hour}:00`
    }
  }
  return date.slice(5)
}
