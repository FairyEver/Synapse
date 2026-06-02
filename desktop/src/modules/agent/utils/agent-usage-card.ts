import { SYNAPSE_COST_CURRENCY } from "@/lib/cost-currency"
import {
  formatTokenUsageValue,
  normalizeClaudeSdkUsage,
  type ClaudeSdkUsageSummary,
} from "@/lib/token-usage"

export type AgentUsageRowKey = "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning"

export type AgentUsageCostBreakdownCny = Partial<Record<AgentUsageRowKey, number>>

export interface AgentUsageCardRow {
  readonly key: AgentUsageRowKey
  readonly label: string
  readonly total: number
  readonly delta?: number
  readonly percent?: number
  readonly totalCostLabel?: string
  readonly deltaCostLabel?: string
  readonly totalTooltip: string
  readonly deltaTooltip: string
}

export interface AgentUsageCardData {
  readonly rows: readonly AgentUsageCardRow[]
  readonly turnCostLabel?: string
  readonly totalCostLabel?: string
  readonly estimatedCost: boolean
  readonly timestamp?: string
}

export interface BuildAgentUsageCardInput {
  readonly totalUsage?: Record<string, unknown> | ClaudeSdkUsageSummary
  readonly turnUsage?: Record<string, unknown> | ClaudeSdkUsageSummary
  readonly turnCostCny?: number
  readonly totalCostCny?: number
  readonly turnCostBreakdownCny?: AgentUsageCostBreakdownCny
  readonly totalCostBreakdownCny?: AgentUsageCostBreakdownCny
  readonly estimatedCost?: boolean
  readonly timestamp?: string
}

const rowDefinitions: readonly {
  readonly key: AgentUsageRowKey
  readonly label: string
  readonly field: keyof ClaudeSdkUsageSummary
  readonly optional?: boolean
}[] = [
  { key: "input", label: "输入", field: "inputTokens" },
  { key: "output", label: "输出", field: "outputTokens" },
  { key: "cacheRead", label: "缓存读", field: "cacheReadInputTokens" },
  { key: "cacheWrite", label: "缓存写", field: "cacheCreationInputTokens" },
  { key: "reasoning", label: "思考", field: "reasoningOutputTokens", optional: true },
]
const compactCostFormatter = new Intl.NumberFormat("zh-CN", {
  currency: SYNAPSE_COST_CURRENCY,
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
})

function buildAgentUsageCardData(input: BuildAgentUsageCardInput): AgentUsageCardData | undefined {
  const total = normalizeUsageSummary(input.totalUsage)
  if (!total) return undefined
  const turn = normalizeUsageSummary(input.turnUsage)
  const rows = rowDefinitions.flatMap((definition) => {
    const totalValue = tokenValue(total[definition.field])
    const deltaValue = turn ? tokenValue(turn[definition.field]) : undefined
    const totalCostLabel = costLabel(input.totalCostBreakdownCny?.[definition.key])
    const deltaCostLabel = costLabel(input.turnCostBreakdownCny?.[definition.key])
    if (definition.optional && !hasOptionalUsageField(input.totalUsage, definition.field) && !hasOptionalUsageField(input.turnUsage, definition.field)) {
      return []
    }
    return [{
      key: definition.key,
      label: definition.label,
      total: totalValue,
      delta: deltaValue,
      percent: deltaValue === undefined ? undefined : percentage(deltaValue, totalValue),
      totalCostLabel,
      deltaCostLabel,
      totalTooltip: buildTotalTooltip(definition.label, totalValue),
      deltaTooltip: buildDeltaTooltip(definition.label, deltaValue),
    }]
  })
  if (rows.length === 0) return undefined
  const turnCostLabel = costLabel(input.turnCostCny)
  const totalCostLabel = costLabel(input.totalCostCny)
  const hasCost = turnCostLabel !== undefined || totalCostLabel !== undefined
  return {
    rows,
    turnCostLabel,
    totalCostLabel,
    estimatedCost: hasCost && (input.estimatedCost === true || input.turnCostCny !== undefined || input.totalCostCny !== undefined),
    timestamp: input.timestamp,
  }
}

function formatAgentUsageCopyText(data: AgentUsageCardData | undefined): string {
  if (!data) return ""
  const costs = [
    data.turnCostLabel ? `本轮费用 ${data.turnCostLabel}` : undefined,
    data.totalCostLabel ? `会话累计费用 ${data.totalCostLabel}` : undefined,
  ].filter(Boolean).join("，")
  const rows = data.rows.map((row) => {
    const details = [
      row.delta === undefined ? undefined : `本轮 +${formatTokenUsageValue(row.delta)}`,
      row.deltaCostLabel === undefined ? undefined : `本轮费用 ${row.deltaCostLabel}`,
      row.percent === undefined ? undefined : `占累计 ${row.percent}%`,
      row.totalCostLabel === undefined ? undefined : `累计费用 ${row.totalCostLabel}`,
    ].filter(Boolean).join("，")
    return `${row.label} ${formatTokenUsageValue(row.total)}${details ? `（${details}）` : ""}`
  }).join("、")
  return [
    `用量统计${costs ? `：${costs}。` : "。"}`,
    `Token 累计：${rows}。`,
    data.estimatedCost ? "价格按当前模型估算。" : undefined,
  ].filter(Boolean).join("\n")
}

function normalizeUsageSummary(
  usage: Record<string, unknown> | ClaudeSdkUsageSummary | undefined,
): ClaudeSdkUsageSummary | undefined {
  if (!usage) return undefined
  if (isClaudeSdkUsageSummary(usage)) return usage
  return normalizeClaudeSdkUsage(usage)
}

function isClaudeSdkUsageSummary(value: Record<string, unknown> | ClaudeSdkUsageSummary): value is ClaudeSdkUsageSummary {
  return typeof value.inputTokens === "number"
    && typeof value.outputTokens === "number"
    && typeof value.cacheReadInputTokens === "number"
    && typeof value.cacheCreationInputTokens === "number"
    && typeof value.totalTokens === "number"
}

function tokenValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function percentage(delta: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((delta / total) * 100)
}

function costLabel(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return compactCostFormatter.format(value)
}

function buildTotalTooltip(label: string, total: number): string {
  return `累计${label} token：${formatTokenUsageValue(total)}`
}

function buildDeltaTooltip(label: string, delta: number | undefined): string {
  if (delta === undefined) return `本轮${label} token 增量暂无数据`
  return `本轮新增${label} token：${formatTokenUsageValue(delta)}`
}

function hasOptionalUsageField(
  usage: Record<string, unknown> | ClaudeSdkUsageSummary | undefined,
  field: keyof ClaudeSdkUsageSummary,
): boolean {
  if (!usage) return false
  if (field in usage && typeof usage[field] === "number") return true
  if (field !== "reasoningOutputTokens") return false
  const raw = usage as Record<string, unknown>
  return typeof raw.reasoning_output_tokens === "number" || typeof raw.reasoning_tokens === "number"
}

export { buildAgentUsageCardData, formatAgentUsageCopyText }
