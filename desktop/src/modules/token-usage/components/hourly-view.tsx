import { useState, useMemo } from "react"
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { formatTokens, formatCost, formatCacheRatio } from "../lib/format"
import { useSort } from "../hooks/use-sort"
import { SortableHeader } from "./sortable-header"
import type { HourlyRow, HourlyProfile } from "../hooks/use-token-usage"

interface HourlyViewProps {
  rows: HourlyRow[]
  profile: HourlyProfile | null
}

type ViewMode = "table" | "profile"

export function HourlyView({ rows, profile }: HourlyViewProps) {
  const [mode, setMode] = useState<ViewMode>("table")

  return (
    <div className="space-y-4">
      <Tabs value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "table" ? (
        <HourlyTable rows={rows} />
      ) : (
        <HourlyProfileView profile={profile} />
      )}
    </div>
  )
}

interface HourlySortRow extends HourlyRow {
  total: number
  cacheHitRate: number
}

function HourlyTable({ rows }: { rows: HourlyRow[] }) {
  const sortRows = useMemo(() => rows.map((r) => {
    const paid = r.input + r.cacheWrite
    return {
      ...r,
      total: r.input + r.output + r.cacheRead + r.cacheWrite + r.reasoning,
      cacheHitRate: paid > 0 ? r.cacheRead / paid : 0,
    }
  }), [rows])

  const { sorted, sortKey, sortDir, toggleSort } = useSort<HourlySortRow>(sortRows, "hour", "desc")
  const hasReasoning = sortRows.some((r) => r.reasoning > 0)
  const hasTurns = sortRows.some((r) => r.turns > 0)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader<HourlySortRow> label="Hour" sortKey="hour" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          <SortableHeader<HourlySortRow> label="Source" sortKey="client" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          {hasTurns && <SortableHeader<HourlySortRow> label="Turns" sortKey="turns" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />}
          <SortableHeader<HourlySortRow> label="Input" sortKey="input" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="Output" sortKey="output" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="Cache R" sortKey="cacheRead" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="Cache W" sortKey="cacheWrite" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="Cache %" sortKey="cacheHitRate" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          {hasReasoning && <SortableHeader<HourlySortRow> label="Reasoning" sortKey="reasoning" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />}
          <SortableHeader<HourlySortRow> label="Total" sortKey="total" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="Msgs" sortKey="messages" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="Cost" sortKey="cost" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r, i) => (
          <TableRow key={`${r.hour}-${r.client}-${r.model}-${i}`}>
            <TableCell>{r.hour}</TableCell>
            <TableCell>{r.client}</TableCell>
            {hasTurns && <TableCell className="text-right">{r.turns}</TableCell>}
            <TableCell className="text-right">{formatTokens(r.input)}</TableCell>
            <TableCell className="text-right">{formatTokens(r.output)}</TableCell>
            <TableCell className="text-right">{formatTokens(r.cacheRead)}</TableCell>
            <TableCell className="text-right">{formatTokens(r.cacheWrite)}</TableCell>
            <TableCell className="text-right">{formatCacheRatio(r.cacheRead, r.input, r.cacheWrite)}</TableCell>
            {hasReasoning && <TableCell className="text-right">{formatTokens(r.reasoning)}</TableCell>}
            <TableCell className="text-right font-medium">{formatTokens(r.total)}</TableCell>
            <TableCell className="text-right">{r.messages.toLocaleString()}</TableCell>
            <TableCell className="text-right">{formatCost(r.cost)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

const PERIOD_ICONS: Record<string, string> = {
  Morning: "🌅",
  Daytime: "☀️",
  Evening: "🌆",
  Night: "🌙",
}

function HourlyProfileView({ profile }: { profile: HourlyProfile | null }) {
  if (!profile) return <p className="text-muted-foreground text-sm">No hourly data available</p>

  const maxPeriodTokens = Math.max(...profile.periods.map((p) => p.tokens))

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-medium">When You Work Most</h3>
        <div className="grid grid-cols-4 gap-3">
          {profile.periods.map((p) => (
            <Card key={p.name} className={p.tokens === maxPeriodTokens && p.tokens > 0 ? "border-primary" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {PERIOD_ICONS[p.name]} {p.name}
                  <span className="text-muted-foreground ml-1 text-xs">
                    {String(p.startHour).padStart(2, "0")}:00–{String(p.endHour % 24).padStart(2, "0")}:00
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div>{formatTokens(p.tokens)} tokens</div>
                <div className="text-muted-foreground">{formatCost(p.cost)}</div>
                <div className="text-muted-foreground">{p.messages.toLocaleString()} msgs</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium">Most Productive Day</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={profile.weekdays} layout="vertical">
            <XAxis type="number" tickFormatter={(v: number) => formatTokens(v)} />
            <YAxis type="category" dataKey="day" width={40} />
            <Tooltip formatter={(value) => [formatTokens(Number(value)), "Tokens"]} />
            <Bar dataKey="tokens" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <Card>
        <CardContent className="py-3">
          <p className="text-sm">
            Peak hour: <span className="font-medium">{profile.peakHour}:00</span>
            {profile.peakHourTokens > 0 && (
              <span className="text-muted-foreground"> — {formatTokens(profile.peakHourTokens)} tokens</span>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
