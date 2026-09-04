import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatSynapseCost } from "@/lib/cost-currency"
import { MetricGrid } from "./metric-grid"
import { ReportState } from "./report-state"
import { UsageBreakdownChart, UsageTodayHourlyChart } from "./usage-charts"
import {
  buildTodayMetricRows,
  buildTodayTimeRows,
  buildTodayModelStructureRows,
  buildTodayTokenStructureRows,
  calculateNewTokens,
  describeTokenStructure,
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
  readonly refreshing?: boolean
}

interface TokenBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export function TodayReportView({ overviewState, timeState, modelsState, refreshing = false }: TodayReportViewProps) {
  const report = overviewState.data
  const timeRows = report ? buildTodayTimeRows(timeState.data ?? [], report.generatedAt) : []
  const modelRows = modelsState.data ?? []
  const loading = (overviewState.loading || timeState.loading || modelsState.loading)
    && (!overviewState.data || !timeState.data || !modelsState.data)
  const error = overviewState.error ?? timeState.error ?? modelsState.error
  const empty = !report || report.totals.tokens === 0

  return (
    <ReportState loading={loading} error={error} empty={empty} refreshing={refreshing}>
      {report ? (
        <div className="flex min-w-0 flex-col gap-2">
          <MetricGrid metrics={buildTodayMetricRows(report, timeRows)} columns="four" />
          <UsageTodayHourlyChart title="今日时段" rows={timeRows} />
          <div className="grid min-w-0 gap-2 md:grid-cols-2">
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
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>今日节奏</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时段</TableHead>
              <TableHead className="text-right">Token</TableHead>
              <TableHead className="text-right">新增</TableHead>
              <TableHead className="text-right">缓存读</TableHead>
              <TableHead className="text-right">费用</TableHead>
              <TableHead className="text-right">请求</TableHead>
              <TableHead>主要模型</TableHead>
              <TableHead>结构</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TodayRhythmRow key={row.bucket} row={row} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function TodayRhythmRow({ row }: { readonly row: UsageTimeBucket }) {
  const breakdown = bucketTokenBreakdown(row)
  return (
    <TableRow>
      <TableCell>{formatTodayHour(row.bucket)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatInteger(calculateNewTokens(breakdown))}</TableCell>
      <TableCell className="text-right tabular-nums">{formatInteger(breakdown.cacheRead)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatEstimatedCost(row.estimatedCost, row.tokens, row.unpricedTokens)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatInteger(row.requests)}</TableCell>
      <TableCell>{row.dominantModel || "-"}</TableCell>
      <TableCell>{describeTokenStructure(breakdown)}</TableCell>
    </TableRow>
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
  return formatSynapseCost(value)
}

function formatEstimatedCost(value: number, tokens: number, unpricedTokens: number): string {
  if (tokens > 0 && unpricedTokens >= tokens) return "未定价"
  return formatCurrency(value)
}
