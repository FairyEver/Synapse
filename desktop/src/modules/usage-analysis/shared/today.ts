import { formatSynapseCost } from "@/lib/cost-currency"
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

const MAX_MODEL_STRUCTURE_ROWS = 5
const TODAY_HOUR_COUNT = 24

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
  _now = new Date(),
): TodayMetricRow[] {
  const recentHour = getRecentHourBucket(timeRows)
  const newTokens = calculateNewTokens(overview.tokenBreakdown)
  const cacheReadShare = formatCacheReadShare(overview.tokenBreakdown)
  const recentHourBreakdown = recentHour ? bucketTokenBreakdown(recentHour) : null

  return [
    {
      label: "今日 Token",
      value: formatInteger(overview.totals.tokens),
      subValue: formatCostSubValue(
        overview.totals.tokens,
        overview.totals.estimatedCost,
        overview.totals.unpricedTokens,
      ),
    },
    {
      label: "新增 Token",
      value: formatInteger(newTokens),
      subValue: "不含缓存读",
    },
    {
      label: "缓存读",
      value: formatInteger(overview.tokenBreakdown.cacheRead),
      subValue: cacheReadShare,
    },
    {
      label: "最近 1 小时",
      value: recentHour ? formatInteger(recentHour.tokens) : "-",
      subValue: recentHour
        ? `${formatInteger(recentHour.requests)} 请求 · 新增 ${formatInteger(calculateNewTokens(recentHourBreakdown ?? emptyBreakdown()))}`
        : undefined,
    },
  ]
}

export function getRecentHourBucket(rows: readonly UsageTimeBucket[]): UsageTimeBucket | null {
  return rows.filter((row) => row.tokens > 0 || row.requests > 0 || row.toolCalls > 0).at(-1) ?? null
}

export function buildTodayTimeRows(rows: readonly UsageTimeBucket[], generatedAt: string): UsageTimeBucket[] {
  const dateKey = rows.find((row) => row.bucket.length >= 10)?.bucket.slice(0, 10) || generatedAt.slice(0, 10)
  const byBucket = new Map(rows.map((row) => [row.bucket, row]))

  return Array.from({ length: TODAY_HOUR_COUNT }, (_, hour) => {
    const bucket = `${dateKey} ${pad2(hour)}`
    return byBucket.get(bucket) ?? emptyHourBucket(bucket)
  })
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

export function describeTokenStructure(breakdown: TokenBreakdownLike): string {
  const dominant = describeDominantTokenComponent(breakdown)
  if (dominant === "-" || breakdown.cacheRead <= 0 || dominant.startsWith("缓存读 ")) return dominant
  return `${dominant} · 缓存读 ${formatCacheReadShare(breakdown)}`
}

export function calculateNewTokens(breakdown: TokenBreakdownLike): number {
  return breakdown.input + breakdown.output + breakdown.cacheWrite + breakdown.reasoning
}

export function formatCacheReadShare(breakdown: TokenBreakdownLike): string {
  const total = TOKEN_COMPONENTS.reduce((sum, component) => sum + breakdown[component.key], 0)
  if (total <= 0 || breakdown.cacheRead <= 0) return "-"
  return formatPercent(breakdown.cacheRead / total)
}

export function formatTodayHour(bucket: string): string {
  return bucket.length >= 13 ? `${bucket.slice(11, 13)}:00` : bucket
}

function formatInteger(value: number): string {
  if (value <= 0) return "-"
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

function formatCurrency(value: number): string {
  if (value <= 0) return "-"
  return formatSynapseCost(value)
}

function formatCostSubValue(tokens: number, estimatedCost: number, unpricedTokens: number): string | undefined {
  if (tokens <= 0) return undefined
  if (unpricedTokens >= tokens) return "未定价"
  if (unpricedTokens > 0 && estimatedCost > 0) return `${formatCurrency(estimatedCost)} · 部分定价`
  return estimatedCost > 0 ? formatCurrency(estimatedCost) : undefined
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 0 }).format(value)
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function emptyHourBucket(bucket: string): UsageTimeBucket {
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

function bucketTokenBreakdown(row: UsageTimeBucket): TokenBreakdownLike {
  return row.modelBreakdown.reduce<TokenBreakdownLike>((total, model) => ({
    input: total.input + model.input,
    output: total.output + model.output,
    cacheRead: total.cacheRead + model.cacheRead,
    cacheWrite: total.cacheWrite + model.cacheWrite,
    reasoning: total.reasoning + model.reasoning,
  }), emptyBreakdown())
}

function emptyBreakdown(): TokenBreakdownLike {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  }
}
