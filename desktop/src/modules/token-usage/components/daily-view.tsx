import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatTokens, formatCost } from "../lib/format"

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

interface DailyViewProps {
  rows: DailyRow[]
}

export function DailyView({ rows }: DailyViewProps) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Turns</TableHead>
          <TableHead className="text-right">Msgs</TableHead>
          <TableHead className="text-right">Input</TableHead>
          <TableHead className="text-right">Output</TableHead>
          <TableHead className="text-right">Cache R</TableHead>
          <TableHead className="text-right">Cache W</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const total = r.input + r.output + r.cacheRead + r.cacheWrite + r.reasoning
          const isToday = r.date === today
          return (
            <TableRow key={r.date} className={isToday ? "bg-muted/50" : undefined}>
              <TableCell className={isToday ? "font-medium" : ""}>{r.date}</TableCell>
              <TableCell className="text-right">{r.turns}</TableCell>
              <TableCell className="text-right">{r.messages}</TableCell>
              <TableCell className="text-right">{formatTokens(r.input)}</TableCell>
              <TableCell className="text-right">{formatTokens(r.output)}</TableCell>
              <TableCell className="text-right">{formatTokens(r.cacheRead)}</TableCell>
              <TableCell className="text-right">{formatTokens(r.cacheWrite)}</TableCell>
              <TableCell className="text-right font-medium">{formatTokens(total)}</TableCell>
              <TableCell className="text-right">{formatCost(r.cost)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
