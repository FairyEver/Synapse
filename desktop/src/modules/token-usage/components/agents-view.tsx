import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatTokens, formatCost } from "../lib/format"
import { getProviderColor } from "../lib/colors"
import { Badge } from "@/components/ui/badge"
import { useSort } from "../hooks/use-sort"
import { SortableHeader } from "./sortable-header"
import type { AgentRow } from "../hooks/use-token-usage"
import { useMemo } from "react"

interface AgentsViewProps {
  agents: AgentRow[]
}

interface AgentSortRow extends AgentRow {
  total: number
  modelCount: number
}

export function AgentsView({ agents }: AgentsViewProps) {
  const rows = useMemo(() => agents.map((a) => ({
    ...a,
    total: a.input + a.output + a.cacheRead + a.cacheWrite + a.reasoning,
    modelCount: a.models.length,
  })), [agents])

  const { sorted, sortKey, sortDir, toggleSort } = useSort<AgentSortRow>(rows, "cost", "desc")
  const hasReasoning = rows.some((r) => r.reasoning > 0)

  if (agents.length === 0) {
    return (
      <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
        No agent data available.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader<AgentSortRow> label="#" sortKey="total" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="w-8" />
          <SortableHeader<AgentSortRow> label="Agent" sortKey="client" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          <SortableHeader<AgentSortRow> label="Providers" sortKey="client" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          <SortableHeader<AgentSortRow> label="Models" sortKey="modelCount" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<AgentSortRow> label="Days" sortKey="activeDays" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<AgentSortRow> label="Messages" sortKey="messageCount" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<AgentSortRow> label="Input" sortKey="input" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<AgentSortRow> label="Output" sortKey="output" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          {hasReasoning && <SortableHeader<AgentSortRow> label="Reasoning" sortKey="reasoning" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />}
          <SortableHeader<AgentSortRow> label="Total" sortKey="total" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<AgentSortRow> label="Cost" sortKey="cost" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((a, i) => (
          <TableRow key={a.client}>
            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
            <TableCell className="font-medium">{a.client}</TableCell>
            <TableCell>
              <span className="flex flex-wrap gap-1">
                {a.providers.slice(0, 3).map((p) => (
                  <Badge key={p} variant="outline" className="gap-1 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: getProviderColor(p) }} />
                    {p}
                  </Badge>
                ))}
                {a.providers.length > 3 && (
                  <Badge variant="outline" className="text-xs">+{a.providers.length - 3}</Badge>
                )}
              </span>
            </TableCell>
            <TableCell className="text-right">{a.models.length}</TableCell>
            <TableCell className="text-right">{a.activeDays}</TableCell>
            <TableCell className="text-right">{a.messageCount.toLocaleString()}</TableCell>
            <TableCell className="text-right">{formatTokens(a.input)}</TableCell>
            <TableCell className="text-right">{formatTokens(a.output)}</TableCell>
            {hasReasoning && <TableCell className="text-right">{formatTokens(a.reasoning)}</TableCell>}
            <TableCell className="text-right font-medium">{formatTokens(a.total)}</TableCell>
            <TableCell className="text-right">{formatCost(a.cost)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
