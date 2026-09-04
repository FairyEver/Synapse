import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatSynapseCost } from "@/lib/cost-currency"
import { MetricGrid } from "./metric-grid"
import { ReportState } from "./report-state"
import { UsageBreakdownChart, UsageRankChart, UsageTrendChart } from "./usage-charts"
import type {
  ReportState as LoaderState,
  UsageDetailRow,
  UsageModelRow,
  UsageOverviewReport,
  UsageProjectRow,
  UsageTrendBucketGranularity,
  UsageTimeBucket,
  UsageToolRow,
} from "../types"

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)
}

function formatCurrency(value: number): string {
  return formatSynapseCost(value)
}

function formatEstimatedCost(value: number, tokens: number, unpricedTokens: number): string {
  if (tokens > 0 && unpricedTokens >= tokens) return "未定价"
  return formatCurrency(value)
}

function costStatus(tokens: number, unpricedTokens: number): string | undefined {
  if (tokens <= 0 || unpricedTokens <= 0) return undefined
  return unpricedTokens >= tokens ? "未定价" : "部分定价"
}

function modelCostLabel(row: UsageModelRow): string {
  return `费用 ${formatEstimatedCost(row.estimatedCost, row.tokens, row.unpricedTokens)}`
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(value)
}

function projectKey(row: UsageProjectRow): string {
  return row.workspaceKey || row.workspaceLabel
}

function createProjectLabelMap(rows: readonly UsageProjectRow[]): Map<string, string> {
  const parsed = rows.map((row) => ({
    key: projectKey(row),
    parts: projectPathParts(row.workspaceLabel || row.workspaceKey),
  }))
  const depthByKey = new Map(parsed.map((item) => [item.key, 1]))

  while (true) {
    const labels = new Map<string, string[]>()
    for (const item of parsed) {
      const depth = depthByKey.get(item.key) ?? 1
      const label = item.parts.slice(-depth).join("/")
      labels.set(label, [...(labels.get(label) ?? []), item.key])
    }
    const duplicates = [...labels.values()].filter((keys) => keys.length > 1)
    if (duplicates.length === 0) break
    let changed = false
    for (const keys of duplicates) {
      for (const key of keys) {
        const item = parsed.find((candidate) => candidate.key === key)
        const currentDepth = depthByKey.get(key) ?? 1
        if (item && currentDepth < item.parts.length) {
          depthByKey.set(key, currentDepth + 1)
          changed = true
        }
      }
    }
    if (!changed) break
  }

  return new Map(parsed.map((item) => {
    const depth = depthByKey.get(item.key) ?? 1
    return [item.key, item.parts.slice(-depth).join("/") || item.key || "unknown"]
  }))
}

function projectPathParts(value: string): string[] {
  const normalized = normalizeProjectPath(value)
  const parts = normalized.split("/").filter(Boolean)
  return parts.length > 0 ? parts : [normalized || "unknown"]
}

function normalizeProjectPath(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/")
  if (trimmed.startsWith("-Users-")) {
    return trimmed.replace(/^-Users-/, "/Users/")
  }
  return trimmed
}

function tokenChartRows(breakdown: UsageOverviewReport["tokenBreakdown"]) {
  return [
    { label: "输入", value: breakdown.input },
    { label: "输出", value: breakdown.output },
    { label: "缓存读", value: breakdown.cacheRead },
    { label: "缓存写", value: breakdown.cacheWrite },
    { label: "推理", value: breakdown.reasoning },
  ]
}

function newTokens(breakdown: UsageOverviewReport["tokenBreakdown"]): number {
  return breakdown.input + breakdown.output + breakdown.cacheWrite + breakdown.reasoning
}

function cacheReadShare(breakdown: UsageOverviewReport["tokenBreakdown"]): string {
  const total = breakdown.input + breakdown.output + breakdown.cacheRead + breakdown.cacheWrite + breakdown.reasoning
  if (total <= 0 || breakdown.cacheRead <= 0) return "-"
  return formatPercent(breakdown.cacheRead / total)
}

function costChartRows(breakdown: UsageOverviewReport["costBreakdown"]) {
  return [
    { label: "输入", value: breakdown.input },
    { label: "输出", value: breakdown.output },
    { label: "缓存读", value: breakdown.cacheRead },
    { label: "缓存写", value: breakdown.cacheWrite },
    { label: "推理", value: breakdown.reasoning },
  ]
}

interface TrendBucketProps {
  readonly trendBucket: UsageTrendBucketGranularity
  readonly onTrendBucketChange: (bucket: UsageTrendBucketGranularity) => void
}

interface RefreshingReportProps {
  readonly refreshing?: boolean
}

export function OverviewReportView({ state, trendBucket, onTrendBucketChange, refreshing = false }: {
  readonly state: LoaderState<UsageOverviewReport>
} & TrendBucketProps & RefreshingReportProps) {
  const report = state.data
  const projectLabels = report ? createProjectLabelMap(report.topProjects) : new Map<string, string>()
  return (
    <ReportState loading={state.loading && !report} error={state.error} empty={!report || report.totals.tokens === 0} refreshing={refreshing}>
      {report ? (
        <div className="flex min-w-0 flex-col gap-2">
          <MetricGrid
            metrics={[
              { label: "Token", value: formatInteger(report.totals.tokens) },
              { label: "新增 Token", value: formatInteger(newTokens(report.tokenBreakdown)), subValue: "不含缓存读" },
              { label: "缓存读", value: formatInteger(report.tokenBreakdown.cacheRead), subValue: cacheReadShare(report.tokenBreakdown) },
              {
                label: "估算费用",
                value: formatEstimatedCost(report.totals.estimatedCost, report.totals.tokens, report.totals.unpricedTokens),
                subValue: costStatus(report.totals.tokens, report.totals.unpricedTokens),
              },
              { label: "请求", value: formatInteger(report.totals.requests) },
              { label: "会话", value: formatInteger(report.totals.conversations) },
            ]}
          />
          <UsageTrendChart title="Token 趋势" rows={report.trend} bucket={trendBucket} onBucketChange={onTrendBucketChange} />
          <div className="grid min-w-0 gap-2 md:grid-cols-2">
            <UsageBreakdownChart title="Token 类型占比" rows={tokenChartRows(report.tokenBreakdown)} valueFormatter={formatInteger} compact />
            <UsageBreakdownChart title="费用类型占比" rows={costChartRows(report.costBreakdown)} valueFormatter={formatCurrency} compact />
          </div>
          <div className="grid min-w-0 gap-2 xl:grid-cols-3">
            <UsageRankChart title="模型 Token 排行" rows={report.topModels.map((row) => ({ label: row.model, value: row.tokens, extraLabel: modelCostLabel(row) }))} valueFormatter={formatInteger} />
            <UsageRankChart title="项目 Token 排行" rows={report.topProjects.map((row) => ({ label: projectLabels.get(projectKey(row)) ?? row.workspaceLabel, value: row.tokens, extra: row.requests }))} valueFormatter={formatInteger} extraFormatter={(value) => `请求 ${formatInteger(value)}`} />
            <UsageRankChart title="工具调用排行" rows={report.topTools.map((row) => ({ label: row.toolName, value: row.calls, extra: row.failureRate }))} valueFormatter={formatInteger} extraFormatter={(value) => `失败率 ${formatPercent(value)}`} />
          </div>
        </div>
      ) : null}
    </ReportState>
  )
}

export function TimeReportView({ state, trendBucket, onTrendBucketChange, refreshing = false }: {
  readonly state: LoaderState<UsageTimeBucket[]>
} & TrendBucketProps & RefreshingReportProps) {
  const rows = state.data ?? []
  return (
    <ReportState loading={state.loading && !state.data} error={state.error} empty={rows.length === 0} refreshing={refreshing}>
      <div className="flex min-w-0 flex-col gap-2">
        <UsageTrendChart title="Token / 请求 / 工具" rows={rows} bucket={trendBucket} onBucketChange={onTrendBucketChange} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead className="text-right">Token</TableHead>
              <TableHead className="text-right">估算费用</TableHead>
              <TableHead className="text-right">请求</TableHead>
              <TableHead className="text-right">工具</TableHead>
              <TableHead>主要模型</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.bucket}>
                <TableCell>{row.bucket}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEstimatedCost(row.estimatedCost, row.tokens, row.unpricedTokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.requests)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell>
                <TableCell>{row.dominantModel || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ReportState>
  )
}

export function ModelsReportView({ state, refreshing = false }: { readonly state: LoaderState<UsageModelRow[]> } & RefreshingReportProps) {
  const rows = state.data ?? []
  return (
    <ReportState loading={state.loading && !state.data} error={state.error} empty={rows.length === 0} refreshing={refreshing}>
      <div className="flex min-w-0 flex-col gap-2">
        <UsageRankChart title="Token 排行" rows={rows.map((row) => ({ label: row.model, value: row.tokens, extraLabel: modelCostLabel(row) }))} valueFormatter={formatInteger} />
        <UsageBreakdownChart title="模型费用占比" rows={rows.map((row) => ({ label: row.model, value: row.estimatedCost }))} valueFormatter={formatCurrency} />
        <ModelTable rows={rows} />
      </div>
    </ReportState>
  )
}

export function ProjectsReportView({ state, refreshing = false }: { readonly state: LoaderState<UsageProjectRow[]> } & RefreshingReportProps) {
  const rows = state.data ?? []
  const projectLabels = createProjectLabelMap(rows)
  return (
    <ReportState loading={state.loading && !state.data} error={state.error} empty={rows.length === 0} refreshing={refreshing}>
      <div className="flex min-w-0 flex-col gap-2">
        <UsageRankChart title="Token 排行" rows={rows.map((row) => ({ label: projectLabels.get(projectKey(row)) ?? row.workspaceLabel, value: row.tokens, extra: row.requests }))} valueFormatter={formatInteger} extraFormatter={(value) => `请求 ${formatInteger(value)}`} />
        <UsageRankChart title="工具调用排行" rows={rows.map((row) => ({ label: projectLabels.get(projectKey(row)) ?? row.workspaceLabel, value: row.toolCalls, extra: row.sessions }))} valueFormatter={formatInteger} extraFormatter={(value) => `会话 ${formatInteger(value)}`} />
        <ProjectTable rows={rows} labels={projectLabels} />
      </div>
    </ReportState>
  )
}

export function ToolsReportView({ state, refreshing = false }: { readonly state: LoaderState<UsageToolRow[]> } & RefreshingReportProps) {
  const rows = state.data ?? []
  return (
    <ReportState loading={state.loading && !state.data} error={state.error} empty={rows.length === 0} refreshing={refreshing}>
      <div className="flex min-w-0 flex-col gap-2">
        <UsageRankChart title="调用排行" rows={rows.map((row) => ({ label: row.toolName, value: row.calls, extra: row.failureRate }))} valueFormatter={formatInteger} extraFormatter={(value) => `失败率 ${formatPercent(value)}`} />
        <UsageBreakdownChart title="失败占比" rows={rows.map((row) => ({ label: row.toolName, value: row.failures }))} valueFormatter={formatInteger} />
        <ToolTable rows={rows} />
      </div>
    </ReportState>
  )
}

export function DetailsReportView({
  state,
  onOpenConversation,
  refreshing = false,
}: {
  readonly state: LoaderState<UsageDetailRow[]>
  readonly onOpenConversation?: (row: UsageDetailRow) => void
} & RefreshingReportProps) {
  const rows = state.data ?? []
  return (
    <ReportState loading={state.loading && !state.data} error={state.error} empty={rows.length === 0} refreshing={refreshing}>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="text-sm text-muted-foreground">最近 200 条</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>会话</TableHead>
              <TableHead>项目</TableHead>
              <TableHead>模型</TableHead>
              <TableHead className="text-right">Token</TableHead>
              <TableHead className="text-right">估算费用</TableHead>
              <TableHead className="text-right">工具</TableHead>
              {onOpenConversation ? <TableHead className="text-right">操作</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.timestamp}</TableCell>
                <TableCell>{row.sessionId}</TableCell>
                <TableCell>{row.workspaceLabel}</TableCell>
                <TableCell>{row.model}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEstimatedCost(row.estimatedCost, row.tokens, row.unpricedTokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell>
                {onOpenConversation ? (
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpenConversation(row)}>
                      <ExternalLink data-icon="inline-start" />
                      打开对话
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ReportState>
  )
}

function ModelTable({ title, rows, compact = false }: { readonly title?: string; readonly rows: readonly UsageModelRow[]; readonly compact?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {title ? <h3 className="text-sm font-medium">{title}</h3> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>模型</TableHead>
            {!compact ? <TableHead>Provider</TableHead> : null}
            <TableHead className="text-right">Token</TableHead>
            <TableHead className="text-right">费用</TableHead>
            {!compact ? <TableHead className="text-right">请求</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.provider ?? ""}:${row.model}`}>
              <TableCell>{row.model}</TableCell>
              {!compact ? <TableCell>{row.provider ?? "-"}</TableCell> : null}
              <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatEstimatedCost(row.estimatedCost, row.tokens, row.unpricedTokens)}</TableCell>
              {!compact ? <TableCell className="text-right tabular-nums">{formatInteger(row.requests)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ProjectTable({
  title,
  rows,
  labels = createProjectLabelMap(rows),
  compact = false,
}: {
  readonly title?: string
  readonly rows: readonly UsageProjectRow[]
  readonly labels?: ReadonlyMap<string, string>
  readonly compact?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {title ? <h3 className="text-sm font-medium">{title}</h3> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>项目</TableHead>
            {!compact ? <TableHead>路径</TableHead> : null}
            <TableHead className="text-right">Token</TableHead>
            <TableHead className="text-right">请求</TableHead>
            {!compact ? <TableHead className="text-right">工具</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.workspaceKey || row.workspaceLabel}>
              <TableCell>{labels.get(projectKey(row)) ?? row.workspaceLabel ?? "-"}</TableCell>
              {!compact ? <TableCell>{row.workspaceKey || "-"}</TableCell> : null}
              <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.requests)}</TableCell>
              {!compact ? <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ToolTable({ title, rows, compact = false }: { readonly title?: string; readonly rows: readonly UsageToolRow[]; readonly compact?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {title ? <h3 className="text-sm font-medium">{title}</h3> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>工具</TableHead>
            {!compact ? <TableHead>类型</TableHead> : null}
            <TableHead className="text-right">调用</TableHead>
            <TableHead className="text-right">失败率</TableHead>
            {!compact ? <TableHead className="text-right">平均耗时</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.category}:${row.toolName}`}>
              <TableCell>{row.toolName}</TableCell>
              {!compact ? (
                <TableCell>
                  <Badge variant="secondary">{row.category}</Badge>
                </TableCell>
              ) : null}
              <TableCell className="text-right tabular-nums">{formatInteger(row.calls)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPercent(row.failureRate)}</TableCell>
              {!compact ? <TableCell className="text-right tabular-nums">{formatDecimal(row.averageDurationMs)} ms</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
