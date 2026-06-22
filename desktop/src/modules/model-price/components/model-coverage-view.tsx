import type { ReactNode } from "react"
import { ModuleContentPanel } from "@/components/module-page"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatSynapseCost } from "@/lib/cost-currency"
import type { ModelPriceCoverageRow, ModelPriceState } from "../types"

interface ModelCoverageViewProps {
  readonly state: ModelPriceState<ModelPriceCoverageRow[]>
}

export function ModelCoverageView({ state }: ModelCoverageViewProps) {
  if (state.loading && !state.data) {
    return (
      <CoveragePanel>
        <div className="space-y-2 p-2">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      </CoveragePanel>
    )
  }

  if (state.error) {
    return (
      <CoveragePanel>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>读取失败</EmptyTitle>
            <EmptyDescription>{state.error.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CoveragePanel>
    )
  }

  const rows = state.data ?? []
  if (rows.length === 0) {
    return (
      <CoveragePanel>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>暂无覆盖数据</EmptyTitle>
            <EmptyDescription>刷新后查看 CC 或 Codex 使用记录。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CoveragePanel>
    )
  }

  return (
    <CoveragePanel>
      <Table className="table-fixed" containerClassName="overflow-x-hidden">
        <colgroup>
          <col className="w-2/5" />
          <col className="w-1/4" />
          <col />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>模型</TableHead>
            <TableHead>当前规则</TableHead>
            <TableHead className="text-right">用量</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.model}>
              <TableCell className="whitespace-normal">
                <div className="flex min-w-0 flex-col items-start gap-1">
                  <span className="min-w-0 break-all font-medium">{row.model}</span>
                  <span className="flex flex-wrap gap-1">
                    {row.sources.map((source) => (
                      <Badge key={source} variant="secondary">{sourceLabel(source)}</Badge>
                    ))}
                  </span>
                </div>
              </TableCell>
              <TableCell className="whitespace-normal">{renderPricingStatus(row)}</TableCell>
              <TableCell className="whitespace-normal">
                <UsageSummary row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CoveragePanel>
  )
}

function CoveragePanel({ children }: { readonly children: ReactNode }) {
  return (
    <ModuleContentPanel className="overflow-hidden">
      {children}
    </ModuleContentPanel>
  )
}

function renderPricingStatus(row: ModelPriceCoverageRow): ReactNode {
  if (!row.priceKnown) {
    return <span className="text-muted-foreground">无匹配规则</span>
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Badge variant="outline">规则已匹配</Badge>
      <span className="min-w-0 break-all text-muted-foreground">{row.matchedRulePattern}</span>
    </div>
  )
}

function UsageSummary({ row }: { readonly row: ModelPriceCoverageRow }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
      <UsageMetric label="Tokens" value={formatInteger(row.tokens)} />
      <UsageMetric label="请求" value={formatInteger(row.requests)} />
      <UsageMetric label="未计价" value={formatInteger(row.unpricedTokens)} />
      <UsageMetric label="已计费用" value={formatSynapseCost(row.estimatedCost)} />
    </dl>
  )
}

function UsageMetric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right tabular-nums">{value}</dd>
    </>
  )
}

function sourceLabel(source: ModelPriceCoverageRow["sources"][number]): string {
  return source === "cc" ? "CC" : "Codex"
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value)
}
