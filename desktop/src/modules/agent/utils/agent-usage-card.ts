import {
  formatTokenUsageValue,
  normalizeClaudeSdkUsage,
  type ClaudeSdkUsageSummary,
} from "@/lib/token-usage"

export type AgentUsageRowKey = "input" | "output" | "cacheRead" | "cacheWrite" | "reasoning"

export interface AgentUsageCardRow {
  readonly key: AgentUsageRowKey
  readonly label: string
  readonly total: number
  readonly delta?: number
  readonly percent?: number
  readonly totalTooltip: string
  readonly deltaTooltip: string
}

export interface AgentUsageCardData {
  readonly rows: readonly AgentUsageCardRow[]
  readonly timestamp?: string
}

export interface BuildAgentUsageCardInput {
  readonly totalUsage?: Record<string, unknown> | ClaudeSdkUsageSummary
  readonly turnUsage?: Record<string, unknown> | ClaudeSdkUsageSummary
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

function buildAgentUsageCardData(input: BuildAgentUsageCardInput): AgentUsageCardData | undefined {
  const total = normalizeUsageSummary(input.totalUsage)
  if (!total) return undefined
  const turn = normalizeUsageSummary(input.turnUsage)
  const rows = rowDefinitions.flatMap((definition) => {
    const totalValue = tokenValue(total[definition.field])
    const deltaValue = turn ? tokenValue(turn[definition.field]) : undefined
    if (definition.optional && !hasOptionalUsageField(input.totalUsage, definition.field) && !hasOptionalUsageField(input.turnUsage, definition.field)) {
      return []
    }
    return [{
      key: definition.key,
      label: definition.label,
      total: totalValue,
      delta: deltaValue,
      percent: deltaValue === undefined ? undefined : percentage(deltaValue, totalValue),
      totalTooltip: buildTotalTooltip(definition.label, totalValue),
      deltaTooltip: buildDeltaTooltip(definition.label, deltaValue),
    }]
  })
  if (rows.length === 0) return undefined
  return {
    rows,
    timestamp: input.timestamp,
  }
}

function formatAgentUsageCopyText(data: AgentUsageCardData | undefined): string {
  if (!data) return ""
  const rows = data.rows.map((row) => {
    const details = [
      row.delta === undefined ? undefined : `本轮 +${formatTokenUsageValue(row.delta)}`,
      row.percent === undefined ? undefined : `占累计 ${row.percent}%`,
    ].filter(Boolean).join("，")
    return `${row.label} ${formatTokenUsageValue(row.total)}${details ? `（${details}）` : ""}`
  }).join("、")
  return [
    "用量统计",
    `Token 累计：${rows}。`,
  ].join("\n")
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
