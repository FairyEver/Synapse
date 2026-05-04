import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatTokens, formatCost } from "../lib/format"
import { getProviderColor } from "../lib/colors"
import { Badge } from "@/components/ui/badge"
import type { AgentRow } from "../hooks/use-token-usage"

interface AgentsViewProps {
  agents: AgentRow[]
}

export function AgentsView({ agents }: AgentsViewProps) {
  if (agents.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No agent data available.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Providers</TableHead>
          <TableHead className="text-right">Models</TableHead>
          <TableHead className="text-right">Days</TableHead>
          <TableHead className="text-right">Messages</TableHead>
          <TableHead className="text-right">Input</TableHead>
          <TableHead className="text-right">Output</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((a, i) => {
          const total = a.input + a.output + a.cacheRead + a.cacheWrite + a.reasoning
          return (
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
              <TableCell className="text-right font-medium">{formatTokens(total)}</TableCell>
              <TableCell className="text-right">{formatCost(a.cost)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
