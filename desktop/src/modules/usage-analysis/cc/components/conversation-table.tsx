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
import { formatSynapseCost } from "@/lib/cost-currency"
import type { CcConversationListItem } from "@/types/usage-analysis-conversations"

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)
}

export function ConversationTable({
  rows,
  onOpen,
}: {
  readonly rows: readonly CcConversationListItem[]
  readonly onOpen: (row: CcConversationListItem) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>标题</TableHead>
          <TableHead>项目</TableHead>
          <TableHead>模型</TableHead>
          <TableHead className="text-right">Token</TableHead>
          <TableHead className="text-right">费用</TableHead>
          <TableHead className="text-right">工具</TableHead>
          <TableHead className="text-right">事件</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.sessionId}>
            <TableCell>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">{row.title || row.sessionId}</span>
                {row.matchSnippets?.map((snippet) => (
                  <span key={`${row.sessionId}:${snippet.eventId}`} className="max-w-xl truncate text-xs text-muted-foreground">
                    {snippet.text}
                  </span>
                ))}
              </div>
            </TableCell>
            <TableCell>{row.workspaceLabel || row.workspaceKey || "-"}</TableCell>
            <TableCell>{row.modelSummary || "-"}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInteger(row.tokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatSynapseCost(row.estimatedCost)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInteger(row.toolCalls)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatInteger(row.eventCount)}</TableCell>
            <TableCell className="text-right">
              <Button type="button" size="sm" variant="outline" onClick={() => onOpen(row)}>
                <ExternalLink data-icon="inline-start" />
                打开对话
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
