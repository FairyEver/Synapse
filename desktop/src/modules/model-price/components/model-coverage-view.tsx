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
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  if (state.error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>读取失败</EmptyTitle>
          <EmptyDescription>{state.error.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const rows = state.data ?? []
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>暂无模型</EmptyTitle>
          <EmptyDescription>刷新 CC 或 Codex 后查看覆盖情况。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ModuleContentPanel className="overflow-x-auto">
      <Table className="min-w-[60rem] table-fixed">
        <colgroup>
          <col className="w-auto" />
          <col className="w-32" />
          <col className="w-64" />
          <col className="w-40" />
          <col className="w-28" />
          <col className="w-32" />
          <col className="w-36" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>模型</TableHead>
            <TableHead>来源</TableHead>
            <TableHead>规则</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">请求</TableHead>
            <TableHead className="text-right">未定价</TableHead>
            <TableHead className="text-right">费用</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.model}>
              <TableCell className="font-medium">{row.model}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {row.sources.map((source) => (
                    <Badge key={source} variant="secondary">{sourceLabel(source)}</Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>{row.priceKnown ? row.matchedRulePattern : <span className="text-muted-foreground">未匹配</span>}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.requests)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatInteger(row.unpricedTokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatSynapseCost(row.estimatedCost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ModuleContentPanel>
  )
}

function sourceLabel(source: ModelPriceCoverageRow["sources"][number]): string {
  return source === "cc" ? "CC" : "Codex"
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value)
}
