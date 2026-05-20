import { useMemo, useState, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useUsageEChartsTheme } from "../echarts-theme"
import type { UsageTrendBucketGranularity } from "../types"

interface TrendPoint {
  readonly bucket: string
  readonly tokens: number
  readonly estimatedCost: number
  readonly requests: number
  readonly toolCalls: number
  readonly modelBreakdown?: readonly TrendModelPoint[]
}

interface TrendModelPoint {
  readonly model: string
  readonly tokens: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

interface BreakdownPoint {
  readonly label: string
  readonly value: number
}

interface RankPoint {
  readonly label: string
  readonly value: number
  readonly extra?: number
}

interface UsageTrendChartProps {
  readonly title: string
  readonly rows: readonly TrendPoint[]
  readonly bucket?: UsageTrendBucketGranularity
  readonly onBucketChange?: (bucket: UsageTrendBucketGranularity) => void
}

interface UsageTodayHourlyChartProps {
  readonly title: string
  readonly rows: readonly TrendPoint[]
}

interface UsageBreakdownChartProps {
  readonly title: string
  readonly rows: readonly BreakdownPoint[]
  readonly valueFormatter: (value: number) => string
  readonly compact?: boolean
}

interface UsageRankChartProps {
  readonly title: string
  readonly rows: readonly RankPoint[]
  readonly valueFormatter: (value: number) => string
  readonly extraFormatter?: (value: number) => string
}

type TrendMode = "tokens" | "newTokens" | "input" | "output" | "cacheRead" | "cacheWrite"
type TokenComponentKey = "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning"

const TREND_MODES: { readonly value: TrendMode; readonly label: string }[] = [
  { value: "tokens", label: "全部" },
  { value: "newTokens", label: "新增" },
  { value: "input", label: "输入" },
  { value: "output", label: "输出" },
  { value: "cacheRead", label: "缓存读" },
  { value: "cacheWrite", label: "缓存写" },
]

const TREND_BUCKETS: { readonly value: UsageTrendBucketGranularity; readonly label: string }[] = [
  { value: "hour", label: "按小时" },
  { value: "day", label: "按天" },
]

const TOKEN_COMPONENTS: { readonly key: TokenComponentKey; readonly label: string }[] = [
  { key: "input", label: "输入" },
  { key: "output", label: "输出" },
  { key: "cacheRead", label: "缓存读" },
  { key: "cacheWrite", label: "缓存写" },
  { key: "reasoning", label: "推理" },
]

const RANK_BAR_HEIGHT = 18
const RANK_BAR_GAP = 9
const RANK_VERTICAL_PADDING = 50

export function UsageTrendChart({ title, rows, bucket = "day", onBucketChange }: UsageTrendChartProps) {
  const theme = useUsageEChartsTheme()
  const [mode, setMode] = useState<TrendMode>("tokens")
  const data = useMemo(() => rows.filter((row) => row.tokens > 0 || row.requests > 0 || row.toolCalls > 0), [rows])
  const models = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of data) {
      for (const model of row.modelBreakdown ?? []) {
        totals.set(model.model, (totals.get(model.model) ?? 0) + valueForMode(model, mode))
      }
    }
    return [...totals.entries()]
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([model]) => model)
  }, [data, mode])
  const option = useMemo<EChartsOption>(() => ({
    color: theme.chart,
    animation: false,
    grid: { top: 34, right: 16, bottom: 28, left: 56 },
    legend: {
      type: "scroll",
      top: 0,
      right: 0,
      textStyle: { color: theme.mutedForeground },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: theme.border, width: 1 } },
      appendToBody: true,
      confine: true,
      transitionDuration: 0,
      position: positionTooltipAwayFromPointer,
      formatter: (params: unknown) => formatTrendTooltip(params, data),
    },
    xAxis: {
      type: "category",
      data: data.map((row) => formatBucket(row.bucket)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.mutedForeground },
    },
    yAxis: [
      {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: theme.border } },
        axisLabel: { color: theme.mutedForeground, formatter: (value: number) => formatCompact(value) },
      },
      {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: theme.mutedForeground, formatter: (value: number) => formatCompact(value) },
      },
    ],
    series: [
      ...models.map((model, index) => ({
        name: model,
        type: "bar" as const,
        stack: "tokens",
        data: data.map((row) => valueForModel(row, model, mode)),
        barMaxWidth: 36,
        itemStyle: {
          color: theme.chart[index % theme.chart.length],
          borderRadius: index === models.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0],
        },
        emphasis: { disabled: true },
        blur: { itemStyle: { color: theme.chart[index % theme.chart.length], opacity: 1 } },
      })),
      {
        name: "请求",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 3,
        lineStyle: { width: 1, color: theme.chart[3] },
        itemStyle: { color: theme.chart[3], borderColor: theme.chart[3], borderWidth: 0 },
        emphasis: { disabled: true },
        data: data.map((row) => row.requests),
      },
      {
        name: "工具",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 3,
        lineStyle: { width: 1, color: theme.chart[4] },
        itemStyle: { color: theme.chart[4], borderColor: theme.chart[4], borderWidth: 0 },
        emphasis: { disabled: true },
        data: data.map((row) => row.toolCalls),
      },
    ],
  }), [data, mode, models, theme])

  return (
    <ChartCard
      title={title}
      empty={data.length === 0}
      action={(
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={bucket} onValueChange={(value) => onBucketChange?.(value as UsageTrendBucketGranularity)}>
            <TabsList>
              {TREND_BUCKETS.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs value={mode} onValueChange={(value) => setMode(value as TrendMode)}>
            <TabsList>
              {TREND_MODES.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
    >
      <ReactECharts className="h-80 w-full" option={option} opts={{ renderer: "canvas" }} notMerge lazyUpdate />
    </ChartCard>
  )
}

export function UsageTodayHourlyChart({ title, rows }: UsageTodayHourlyChartProps) {
  const theme = useUsageEChartsTheme()
  const data = useMemo(() => [...rows], [rows])
  const option = useMemo<EChartsOption>(() => ({
    color: theme.chart,
    animation: false,
    grid: { top: 34, right: 16, bottom: 28, left: 56 },
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: theme.mutedForeground },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: theme.border, width: 1 } },
      appendToBody: true,
      confine: true,
      transitionDuration: 0,
      position: positionTooltipAwayFromPointer,
      formatter: (params: unknown) => formatTodayHourlyTooltip(params, data),
    },
    xAxis: {
      type: "category",
      data: data.map((row) => formatTodayHourSegment(row.bucket)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.mutedForeground, interval: 0 },
    },
    yAxis: [
      {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: theme.border } },
        axisLabel: { color: theme.mutedForeground, formatter: (value: number) => formatCompact(value) },
      },
      {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: theme.mutedForeground, formatter: (value: number) => formatCompact(value) },
      },
    ],
    series: [
      ...TOKEN_COMPONENTS.map((component, index) => ({
        name: component.label,
        type: "bar" as const,
        stack: "tokens",
        data: data.map((row) => valueForTokenComponent(row, component.key)),
        barMaxWidth: 36,
        itemStyle: {
          color: theme.chart[index % theme.chart.length],
          borderRadius: index === TOKEN_COMPONENTS.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0],
        },
        emphasis: { disabled: true },
        blur: { itemStyle: { color: theme.chart[index % theme.chart.length], opacity: 1 } },
      })),
      {
        name: "请求",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 3,
        lineStyle: { width: 1, color: theme.chart[5 % theme.chart.length] },
        itemStyle: { color: theme.chart[5 % theme.chart.length], borderColor: theme.chart[5 % theme.chart.length], borderWidth: 0 },
        emphasis: { disabled: true },
        data: data.map((row) => row.requests),
      },
    ],
  }), [data, theme])

  return (
    <ChartCard title={title} empty={data.length === 0}>
      <ReactECharts className="h-80 w-full" option={option} opts={{ renderer: "canvas" }} notMerge lazyUpdate />
    </ChartCard>
  )
}

export function UsageBreakdownChart({ title, rows, valueFormatter, compact = false }: UsageBreakdownChartProps) {
  const theme = useUsageEChartsTheme()
  const data = useMemo(() => rows.filter((row) => row.value > 0), [rows])
  const option = useMemo<EChartsOption>(() => ({
    color: theme.chart,
    animation: false,
    tooltip: {
      trigger: "item",
      appendToBody: true,
      confine: true,
      transitionDuration: 0,
      position: positionTooltipAwayFromPointer,
      formatter: (param: unknown) => formatPieTooltip(param, valueFormatter),
    },
    legend: { bottom: 0, textStyle: { color: theme.mutedForeground } },
    series: [{
      name: title,
      type: "pie",
      radius: compact ? ["44%", "68%"] : ["48%", "72%"],
      center: ["50%", "43%"],
      avoidLabelOverlap: true,
      label: {
        color: theme.foreground,
        formatter: (param: { name?: string; percent?: number }) => `${param.name ?? ""} ${formatPercentNumber(param.percent ?? 0)}`,
      },
      labelLine: { lineStyle: { color: theme.border } },
      emphasis: { disabled: true },
      blur: { itemStyle: { opacity: 1 } },
      data: data.map((row, index) => ({
        name: row.label,
        value: row.value,
        itemStyle: { color: theme.chart[index % theme.chart.length] },
      })),
    }],
  }), [data, theme, title, valueFormatter])

  return (
    <ChartCard title={title} empty={data.length === 0} heightClassName={compact ? "h-64" : "h-80"}>
      <ReactECharts className={`${compact ? "h-64" : "h-80"} w-full`} option={option} opts={{ renderer: "canvas" }} notMerge lazyUpdate />
    </ChartCard>
  )
}

export function UsageRankChart({ title, rows, valueFormatter, extraFormatter }: UsageRankChartProps) {
  const theme = useUsageEChartsTheme()
  const data = useMemo(() => rows.filter((row) => row.value > 0).slice(0, 12).reverse(), [rows])
  const chartHeight = rankChartHeight(data.length)
  const option = useMemo<EChartsOption>(() => ({
    color: theme.chart,
    animation: false,
    grid: { top: 12, right: 32, bottom: 20, left: 112 },
    tooltip: {
      trigger: "item",
      appendToBody: true,
      confine: true,
      transitionDuration: 0,
      position: positionTooltipAwayFromPointer,
      formatter: (params: unknown) => formatRankTooltip(params, valueFormatter, extraFormatter),
    },
    xAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.border } },
      axisLabel: { color: theme.mutedForeground, formatter: (value: number) => formatCompact(value) },
    },
    yAxis: {
      type: "category",
      data: data.map((row) => row.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.mutedForeground, width: 84, overflow: "truncate" },
    },
    series: [{
      name: title,
      type: "bar",
      data: data.map((row) => ({ value: row.value, extra: row.extra })),
      barWidth: RANK_BAR_HEIGHT,
      barCategoryGap: RANK_BAR_GAP,
      itemStyle: {
        borderRadius: [0, 4, 4, 0],
        color: (param: { dataIndex?: number }) => theme.chart[(param.dataIndex ?? 0) % theme.chart.length] ?? theme.primary,
      },
      emphasis: { disabled: true },
      blur: { itemStyle: { opacity: 1 } },
      label: {
        show: true,
        position: "right",
        color: theme.mutedForeground,
        formatter: (param: unknown) => valueFormatter(readTooltipValue(param)),
      },
    }],
  }), [data, extraFormatter, theme, title, valueFormatter])

  return (
    <ChartCard title={title} empty={data.length === 0} height={chartHeight}>
      <ReactECharts className="w-full" style={{ height: chartHeight }} option={option} opts={{ renderer: "canvas" }} notMerge lazyUpdate />
    </ChartCard>
  )
}

function ChartCard({
  title,
  empty,
  action,
  heightClassName = "h-80",
  height,
  children,
}: {
  readonly title: string
  readonly empty: boolean
  readonly action?: ReactNode
  readonly heightClassName?: string
  readonly height?: number
  readonly children: ReactNode
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className={`flex ${height ? "" : heightClassName} items-center justify-center text-sm text-muted-foreground`} style={height ? { height } : undefined}>暂无图表数据</div>
        ) : children}
      </CardContent>
    </Card>
  )
}

function rankChartHeight(count: number): number {
  if (count <= 0) return 120
  return RANK_VERTICAL_PADDING + count * RANK_BAR_HEIGHT + Math.max(0, count - 1) * RANK_BAR_GAP
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function formatBucket(bucket: string): string {
  if (bucket.length >= 13) return `${bucket.slice(5, 10)} ${bucket.slice(11, 13)}:00`
  return bucket.length >= 10 ? bucket.slice(5, 10) : bucket
}

function formatHourBucket(bucket: string): string {
  return bucket.length >= 13 ? `${bucket.slice(11, 13)}:00` : formatBucket(bucket)
}

function formatTodayHourSegment(bucket: string): string {
  if (bucket.length < 13) return formatBucket(bucket)
  const hour = Number(bucket.slice(11, 13))
  return Number.isFinite(hour) ? String(hour + 1).padStart(2, "0") : formatHourBucket(bucket)
}

function positionTooltipAwayFromPointer(
  point: number[],
  _params: unknown,
  _dom: unknown,
  _rect: unknown,
  size: { contentSize: number[]; viewSize: number[] },
): [number, number] {
  const [x, y] = point
  const [tooltipWidth, tooltipHeight] = size.contentSize
  const [viewWidth, viewHeight] = size.viewSize
  const nextX = x + tooltipWidth + 24 > viewWidth ? Math.max(8, x - tooltipWidth - 16) : x + 16
  const nextY = Math.min(Math.max(8, y - tooltipHeight / 2), Math.max(8, viewHeight - tooltipHeight - 8))
  return [nextX, nextY]
}

function valueForMode(model: TrendModelPoint, mode: TrendMode): number {
  if (mode === "newTokens") return newTokensForModel(model)
  return model[mode]
}

function valueForModel(row: TrendPoint, modelName: string, mode: TrendMode): number {
  const model = row.modelBreakdown?.find((item) => item.model === modelName)
  return model ? valueForMode(model, mode) : 0
}

function valueForTokenComponent(row: TrendPoint, key: TokenComponentKey): number {
  return row.modelBreakdown?.reduce((sum, model) => sum + model[key], 0) ?? 0
}

function newTokensForModel(model: TrendModelPoint): number {
  return model.input + model.output + model.cacheWrite + model.reasoning
}

function formatTrendTooltip(params: unknown, rows: readonly TrendPoint[]): string {
  const items = (Array.isArray(params) ? params : [params]).filter(isTooltipObject)
  const title = String(items[0]?.axisValue ?? items[0]?.axisValueLabel ?? "")
  const row = rows.find((item) => formatBucket(item.bucket) === title)
  const bars = items
    .filter((item) => item.componentSubType === "bar")
    .map((item) => ({ marker: item.marker ?? "", name: item.seriesName ?? "", value: readTooltipValue(item) }))
    .filter((item) => item.value > 0)
  const total = bars.reduce((sum, item) => sum + item.value, 0)
  const lines = items
    .filter((item) => item.componentSubType === "line")
    .map((item) => `${item.marker ?? ""}${item.seriesName ?? ""}: ${formatCompact(readTooltipValue(item))}`)

  return [
    `<div>${title} <span>${formatCompact(total)} Token</span></div>`,
    ...bars.map((item) => `${item.marker}${item.name}: ${formatCompact(item.value)}`),
    ...(row ? [`请求: ${formatCompact(row.requests)}`, `工具: ${formatCompact(row.toolCalls)}`] : lines),
  ].join("<br/>")
}

function formatTodayHourlyTooltip(params: unknown, rows: readonly TrendPoint[]): string {
  const items = (Array.isArray(params) ? params : [params]).filter(isTooltipObject)
  const title = String(items[0]?.axisValue ?? items[0]?.axisValueLabel ?? "")
  const row = rows.find((item) => formatTodayHourSegment(item.bucket) === title)
  const bars = items
    .filter((item) => item.componentSubType === "bar")
    .map((item) => ({ marker: item.marker ?? "", name: item.seriesName ?? "", value: readTooltipValue(item) }))
    .filter((item) => item.value > 0)
  const total = bars.reduce((sum, item) => sum + item.value, 0)

  return [
    `<div>${title} <span>${formatCompact(total)} Token</span></div>`,
    ...bars.map((item) => `${item.marker}${item.name}: ${formatCompact(item.value)}`),
    ...(row ? [`请求: ${formatCompact(row.requests)}`] : []),
  ].join("<br/>")
}

function formatPercentNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value) + "%"
}

function formatPieTooltip(param: unknown, valueFormatter: (value: number) => string): string {
  if (!isTooltipObject(param)) return ""
  return `${param.marker ?? ""}${param.name ?? ""}: ${valueFormatter(readTooltipValue(param))}`
}

function formatRankTooltip(params: unknown, valueFormatter: (value: number) => string, extraFormatter?: (value: number) => string): string {
  const item = Array.isArray(params) ? params.find(isTooltipObject) : params
  if (!isTooltipObject(item)) return ""
  const data = isDataObject(item.data) ? item.data : undefined
  const extra = typeof data?.extra === "number" && extraFormatter ? `<br/>${extraFormatter(data.extra)}` : ""
  return `${item.marker ?? ""}${item.name ?? ""}: ${valueFormatter(readTooltipValue(item))}${extra}`
}

function isTooltipObject(value: unknown): value is {
  axisValue?: unknown
  axisValueLabel?: string
  componentSubType?: string
  marker?: string
  name?: string
  seriesName?: string
  value?: unknown
  data?: unknown
} {
  return typeof value === "object" && value !== null
}

function isDataObject(value: unknown): value is { extra?: number } {
  return typeof value === "object" && value !== null
}

function readTooltipValue(value: unknown): number {
  if (!isTooltipObject(value)) return 0
  if (typeof value.value === "number") return value.value
  if (Array.isArray(value.value) && typeof value.value[0] === "number") return value.value[0]
  const numericValue = Number(value.value)
  return Number.isFinite(numericValue) ? numericValue : 0
}
