import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MetricGrid } from "./metric-grid"
import { ReportState } from "./report-state"
import { UsageBreakdownChart, UsageTodayHourlyChart } from "./usage-charts"
import {
  buildTodayMetricRows,
  buildTodayModelStructureRows,
  buildTodayTokenStructureRows,
  describeDominantTokenComponent,
  formatTodayHour,
} from "../today"
import type {
  ReportState as LoaderState,
  UsageModelRow,
  UsageOverviewReport,
  UsageTimeBucket,
} from "../types"

interface TodayReportViewProps {
  readonly overviewState: LoaderState<UsageOverviewReport>
  readonly timeState: LoaderState<UsageTimeBucket[]>
  readonly modelsState: LoaderState<UsageModelRow[]>
}

interface TokenBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export function TodayReportView({ overviewState, timeState, modelsState }: TodayReportViewProps) {
  const report = overviewState.data
  const timeRows = timeState.data ?? []
  const modelRows = modelsState.data ?? []
  const loading = (overviewState.loading || timeState.loading || modelsState.loading)
    && (!overviewState.data || !timeState.data || !modelsState.data)
  const error = overviewState.error ?? timeState.error ?? modelsState.error
  const empty = !report || report.totals.tokens === 0

  return (
    <ReportState loading={loading} error={error} empty={empty}>
      {report ? (
        <div className="flex flex-col gap-4">
          <MetricGrid metrics={buildTodayMetricRows(report, timeRows)} columns="four" />
          <UsageTodayHourlyChart title="今日时段" rows={timeRows} />
          <div className="grid gap-4 md:grid-cols-2">
            <UsageBreakdownChart title="Token 结构" rows={buildTodayTokenStructureRows(report.tokenBreakdown)} valueFormatter={formatInteger} compact />
            <UsageBreakdownChart title="模型结构" rows={buildTodayModelStructureRows(modelRows)} valueFormatter={formatInteger} compact />
          </div>
          <TodayRhythmTable rows={timeRows} />
        </div>
      ) : null}
    </ReportState>
  )
}

function TodayRhythmTable({ rows }: { readonly rows: readonly UsageTimeBucket[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">今日节奏</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>时段</TableHead>
            <TableHead className="text-right">Token</TableHead>
            <TableHead className="text-right">费用</TableHead>
            <TableHead className="text-right">请求</TableHead>
            <TableHead>主要模型</TableHead>
            <TableHead>结构</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.bucket}>
              <TableCell>{formatTodayHour(row.bucket)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(row.estimatedCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.requests)}</TableCell>
              <TableCell>{row.dominantModel || "-"}</TableCell>
              <TableCell>{describeDominantTokenComponent(bucketTokenBreakdown(row))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function bucketTokenBreakdown(row: UsageTimeBucket): TokenBreakdown {
  return row.modelBreakdown.reduce<TokenBreakdown>((total, model) => ({
    input: total.input + model.input,
    output: total.output + model.output,
    cacheRead: total.cacheRead + model.cacheRead,
    cacheWrite: total.cacheWrite + model.cacheWrite,
    reasoning: total.reasoning + model.reasoning,
  }), {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  })
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value)
}
