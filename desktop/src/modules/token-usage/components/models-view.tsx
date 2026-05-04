import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatTokens, formatCost } from "../lib/format"
import { getProviderColor } from "../lib/colors"
import type { ModelRow } from "../hooks/use-token-usage"

interface ModelsViewProps {
  models: ModelRow[]
}

export function ModelsView({ models }: ModelsViewProps) {
  if (models.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No model data available.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>Model</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Input</TableHead>
          <TableHead className="text-right">Output</TableHead>
          <TableHead className="text-right">Cache R</TableHead>
          <TableHead className="text-right">Cache W</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((m, i) => {
          const total = m.input + m.output + m.cacheRead + m.cacheWrite + m.reasoning
          return (
            <TableRow key={`${m.client}-${m.model}-${m.provider}`}>
              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="font-medium">{m.model}</TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getProviderColor(m.provider) }} />
                  {m.provider}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{m.client}</TableCell>
              <TableCell className="text-right">{formatTokens(m.input)}</TableCell>
              <TableCell className="text-right">{formatTokens(m.output)}</TableCell>
              <TableCell className="text-right">{formatTokens(m.cacheRead)}</TableCell>
              <TableCell className="text-right">{formatTokens(m.cacheWrite)}</TableCell>
              <TableCell className="text-right font-medium">{formatTokens(total)}</TableCell>
              <TableCell className="text-right">{formatCost(m.cost)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
