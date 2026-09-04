import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  buildWorkflowTokenUsageTable,
  formatWorkflowCostCell,
  formatWorkflowTokenCell,
  formatWorkflowTotalCost,
} from "./token-usage-view-model"

interface TokenUsageViewProps {
  readonly definition: WorkflowDefinition
  readonly nodeResults: Record<string, NodeRunResult>
}

export function TokenUsageView({ definition, nodeResults }: TokenUsageViewProps) {
  const table = buildWorkflowTokenUsageTable(definition, nodeResults)

  if (table.rows.length === 0) {
    return (
      <div className="h-full p-4">
        <div className="text-sm font-medium">Token 消耗</div>
        <div className="mt-3 text-sm text-muted-foreground">暂无 Token 消耗</div>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <div className="mb-3 text-sm font-medium">Token 消耗</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>节点</TableHead>
              <TableHead>模型</TableHead>
              <TableHead className="text-right">输入</TableHead>
              <TableHead className="text-right">输出</TableHead>
              <TableHead className="text-right">缓存读</TableHead>
              <TableHead className="text-right">缓存写</TableHead>
              {table.showReasoning && <TableHead className="text-right">思考</TableHead>}
              <TableHead className="text-right">费用</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row) => (
              <TableRow key={row.nodeId}>
                <TableCell className="font-medium">{row.nodeName}</TableCell>
                <TableCell className="text-muted-foreground">{row.modelName ?? "未记录"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.input)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.output)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.cacheRead)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.cacheWrite)}</TableCell>
                {table.showReasoning && (
                  <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(row.reasoning)}</TableCell>
                )}
                <TableCell className="text-right tabular-nums">{formatWorkflowCostCell(row.usageCost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>合计</TableCell>
              <TableCell className="text-muted-foreground">{table.total.nodeCount} 个节点</TableCell>
              <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.input)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.output)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.cacheRead)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.cacheWrite)}</TableCell>
              {table.showReasoning && (
                <TableCell className="text-right tabular-nums">{formatWorkflowTokenCell(table.total.reasoning)}</TableCell>
              )}
              <TableCell className="text-right tabular-nums">{formatWorkflowTotalCost(table.total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </ScrollArea>
  )
}
