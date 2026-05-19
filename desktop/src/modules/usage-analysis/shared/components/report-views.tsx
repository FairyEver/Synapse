import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { BreakdownTable } from "./breakdown-table"
import { MetricGrid } from "./metric-grid"
import { ReportState } from "./report-state"
import type {
  ReportState as LoaderState,
  UsageDetailRow,
  UsageModelRow,
  UsageOverviewReport,
  UsageProjectRow,
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
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value)
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(value)
}

function tokenRows(breakdown: UsageOverviewReport["tokenBreakdown"]) {
  return [
    { label: "输入", value: formatInteger(breakdown.input) },
    { label: "输出", value: formatInteger(breakdown.output) },
    { label: "缓存读取", value: formatInteger(breakdown.cacheRead) },
    { label: "缓存写入", value: formatInteger(breakdown.cacheWrite) },
    { label: "推理", value: formatInteger(breakdown.reasoning) },
  ]
}

function costRows(breakdown: UsageOverviewReport["costBreakdown"]) {
  return [
    { label: "输入", value: formatCurrency(breakdown.input) },
    { label: "输出", value: formatCurrency(breakdown.output) },
    { label: "缓存读取", value: formatCurrency(breakdown.cacheRead) },
    { label: "缓存写入", value: formatCurrency(breakdown.cacheWrite) },
    { label: "推理", value: formatCurrency(breakdown.reasoning) },
  ]
}

function SectionTitle({ children }: { readonly children: string }) {
  return <h3 className="text-sm font-medium">{children}</h3>
}

export function OverviewReportView({ state }: { readonly state: LoaderState<UsageOverviewReport> }) {
  const report = state.data
  return (
    <ReportState loading={state.loading} error={state.error} empty={!report || report.totals.tokens === 0}>
      {report ? (
        <div className="flex flex-col gap-4">
          <MetricGrid
            metrics={[
              { label: "Token", value: formatInteger(report.totals.tokens) },
              { label: "估算费用", value: formatCurrency(report.totals.estimatedCost) },
              { label: "请求", value: formatInteger(report.totals.requests) },
              { label: "会话", value: formatInteger(report.totals.conversations) },
              { label: "工具", value: formatInteger(report.totals.toolCalls) },
              { label: "活跃天", value: formatInteger(report.totals.activeDays) },
            ]}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownTable title="Token 类型" rows={tokenRows(report.tokenBreakdown)} />
            <BreakdownTable title="费用类型" rows={costRows(report.costBreakdown)} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <ModelTable title="模型" rows={report.topModels} compact />
            <ProjectTable title="项目" rows={report.topProjects} compact />
            <ToolTable title="工具" rows={report.topTools} compact />
          </div>
        </div>
      ) : null}
    </ReportState>
  )
}

export function TimeReportView({ state }: { readonly state: LoaderState<UsageTimeBucket[]> }) {
  const rows = state.data ?? []
  return (
    <ReportState loading={state.loading} error={state.error} empty={rows.length === 0}>
      <div className="flex flex-col gap-2">
        <SectionTitle>时间</SectionTitle>
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
                <TableCell className="text-right tabular-nums">{formatCurrency(row.estimatedCost)}</TableCell>
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

export function ModelsReportView({ state }: { readonly state: LoaderState<UsageModelRow[]> }) {
  const rows = state.data ?? []
  return (
    <ReportState loading={state.loading} error={state.error} empty={rows.length === 0}>
      <ModelTable title="模型" rows={rows} />
    </ReportState>
  )
}

export function ProjectsReportView({ state }: { readonly state: LoaderState<UsageProjectRow[]> }) {
  const rows = state.data ?? []
  return (
    <ReportState loading={state.loading} error={state.error} empty={rows.length === 0}>
      <ProjectTable title="项目" rows={rows} />
    </ReportState>
  )
}

export function ToolsReportView({ state }: { readonly state: LoaderState<UsageToolRow[]> }) {
  const rows = state.data ?? []
  return (
    <ReportState loading={state.loading} error={state.error} empty={rows.length === 0}>
      <ToolTable title="工具" rows={rows} />
    </ReportState>
  )
}

export function DetailsReportView({ state }: { readonly state: LoaderState<UsageDetailRow[]> }) {
  const rows = state.data ?? []
  return (
    <ReportState loading={state.loading} error={state.error} empty={rows.length === 0}>
      <div className="flex flex-col gap-2">
        <SectionTitle>明细</SectionTitle>
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
                <TableCell className="text-right tabular-nums">{formatCurrency(row.estimatedCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ReportState>
  )
}

function ModelTable({ title, rows, compact = false }: { readonly title: string; readonly rows: readonly UsageModelRow[]; readonly compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle>{title}</SectionTitle>
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
              <TableCell className="text-right tabular-nums">{formatCurrency(row.estimatedCost)}</TableCell>
              {!compact ? <TableCell className="text-right tabular-nums">{formatInteger(row.requests)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ProjectTable({ title, rows, compact = false }: { readonly title: string; readonly rows: readonly UsageProjectRow[]; readonly compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle>{title}</SectionTitle>
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
              <TableCell>{row.workspaceLabel || "-"}</TableCell>
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

function ToolTable({ title, rows, compact = false }: { readonly title: string; readonly rows: readonly UsageToolRow[]; readonly compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <SectionTitle>{title}</SectionTitle>
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
