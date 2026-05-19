import type { UsageModelRow, UsageOverviewReport, UsageTimeBucket } from "./types"

export interface TodayMetricRow {
  readonly label: string
  readonly value: string
  readonly subValue?: string
}

export interface TodayBreakdownRow {
  readonly label: string
  readonly value: number
}

interface TokenBreakdownLike {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const MIN_PROJECTION_ELAPSED_MS = 15 * 60 * 1000
const MAX_MODEL_STRUCTURE_ROWS = 5

const TOKEN_COMPONENTS: { readonly key: keyof TokenBreakdownLike; readonly label: string }[] = [
  { key: "input", label: "输入" },
  { key: "output", label: "输出" },
  { key: "cacheRead", label: "缓存读" },
  { key: "cacheWrite", label: "缓存写" },
  { key: "reasoning", label: "推理" },
]

export function buildTodayMetricRows(
  overview: UsageOverviewReport,
  timeRows: readonly UsageTimeBucket[],
  now = new Date(),
): TodayMetricRow[] {
  const recentHour = getRecentHourBucket(timeRows)
  const projectedTokens = projectFullDayValue(overview.totals.tokens, now)
  const projectedCost = projectFullDayValue(overview.totals.estimatedCost, now)

  return [
    { label: "今日 Token", value: formatInteger(overview.totals.tokens) },
    { label: "今日费用", value: formatCurrency(overview.totals.estimatedCost) },
    {
      label: "最近 1 小时",
      value: recentHour ? formatInteger(recentHour.tokens) : "-",
      subValue: recentHour ? `${formatInteger(recentHour.requests)} 请求` : undefined,
    },
    {
      label: "今日预计",
      value: formatInteger(projectedTokens),
      subValue: formatCurrency(projectedCost),
    },
  ]
}

export function getRecentHourBucket(rows: readonly UsageTimeBucket[]): UsageTimeBucket | null {
  return rows.filter((row) => row.tokens > 0 || row.requests > 0 || row.toolCalls > 0).at(-1) ?? null
}

export function buildTodayTokenStructureRows(breakdown: TokenBreakdownLike): TodayBreakdownRow[] {
  return TOKEN_COMPONENTS.map((component) => ({
    label: component.label,
    value: breakdown[component.key],
  }))
}

export function buildTodayModelStructureRows(rows: readonly UsageModelRow[]): TodayBreakdownRow[] {
  const sorted = [...rows].filter((row) => row.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const visible = sorted.slice(0, MAX_MODEL_STRUCTURE_ROWS).map((row) => ({
    label: row.model,
    value: row.tokens,
  }))
  const remainder = sorted.slice(MAX_MODEL_STRUCTURE_ROWS).reduce((sum, row) => sum + row.tokens, 0)

  return remainder > 0 ? [...visible, { label: "其他", value: remainder }] : visible
}

export function describeDominantTokenComponent(breakdown: TokenBreakdownLike): string {
  const total = TOKEN_COMPONENTS.reduce((sum, component) => sum + breakdown[component.key], 0)
  if (total <= 0) return "-"

  const dominant = TOKEN_COMPONENTS
    .map((component) => ({ label: component.label, value: breakdown[component.key] }))
    .sort((a, b) => b.value - a.value)[0]

  return `${dominant.label} ${formatPercent(dominant.value / total)}`
}

export function formatTodayHour(bucket: string): string {
  return bucket.length >= 13 ? `${bucket.slice(11, 13)}:00` : bucket
}

function projectFullDayValue(value: number, now: Date): number {
  if (value <= 0) return 0

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const elapsedMs = now.getTime() - startOfDay.getTime()
  if (elapsedMs <= MIN_PROJECTION_ELAPSED_MS) return 0

  return value / Math.min(1, elapsedMs / DAY_MS)
}

function formatInteger(value: number): string {
  if (value <= 0) return "-"
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

function formatCurrency(value: number): string {
  if (value <= 0) return "-"
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value)
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 0 }).format(value)
}
