import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatTokens, formatCost, formatCacheRatio } from "../lib/format"
import { useSort } from "../hooks/use-sort"
import { SortableHeader } from "./sortable-header"
import { useMemo } from "react"

interface DailyRow {
  date: string
  turns: number
  messages: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  cost: number
}

interface DailySortRow extends DailyRow {
  total: number
  cacheHitRate: number
}

interface DailyViewProps {
  rows: DailyRow[]
}

export function DailyView({ rows }: DailyViewProps) {
  const today = new Date().toISOString().slice(0, 10)

  const sortRows = useMemo(() => rows.map((r) => {
    const paid = r.input + r.cacheWrite
    return {
      ...r,
      total: r.input + r.output + r.cacheRead + r.cacheWrite + r.reasoning,
      cacheHitRate: paid > 0 ? r.cacheRead / paid : 0,
    }
  }), [rows])

  const { sorted, sortKey, sortDir, toggleSort } = useSort<DailySortRow>(sortRows, "date", "desc")
  const hasReasoning = sortRows.some((r) => r.reasoning > 0)
  const hasTurns = sortRows.some((r) => r.turns > 0)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader<DailySortRow> label="Date" sortKey="date" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          {hasTurns && <SortableHeader<DailySortRow> label="Turns" sortKey="turns" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />}
          <SortableHeader<DailySortRow> label="Msgs" sortKey="messages" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<DailySortRow> label="Input" sortKey="input" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<DailySortRow> label="Output" sortKey="output" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<DailySortRow> label="Cache R" sortKey="cacheRead" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<DailySortRow> label="Cache W" sortKey="cacheWrite" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<DailySortRow> label="Cache %" sortKey="cacheHitRate" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          {hasReasoning && <SortableHeader<DailySortRow> label="Reasoning" sortKey="reasoning" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />}
          <SortableHeader<DailySortRow> label="Total" sortKey="total" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<DailySortRow> label="Cost" sortKey="cost" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => {
          const isToday = r.date === today
          return (
            <TableRow key={r.date} className={isToday ? "bg-muted/50" : undefined}>
              <TableCell className={isToday ? "font-medium" : ""}>{r.date}</TableCell>
              {hasTurns && <TableCell className="text-right">{r.turns}</TableCell>}
              <TableCell className="text-right">{r.messages}</TableCell>
              <TableCell className="text-right">{formatTokens(r.input)}</TableCell>
              <TableCell className="text-right">{formatTokens(r.output)}</TableCell>
              <TableCell className="text-right">{formatTokens(r.cacheRead)}</TableCell>
              <TableCell className="text-right">{formatTokens(r.cacheWrite)}</TableCell>
              <TableCell className="text-right">{formatCacheRatio(r.cacheRead, r.input, r.cacheWrite)}</TableCell>
              {hasReasoning && <TableCell className="text-right">{formatTokens(r.reasoning)}</TableCell>}
              <TableCell className="text-right font-medium">{formatTokens(r.total)}</TableCell>
              <TableCell className="text-right">{formatCost(r.cost)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
