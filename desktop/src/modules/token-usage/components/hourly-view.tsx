import { useState, useMemo } from "react"
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table"
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
          <TabsTrigger value="table">表格</TabsTrigger>
          <TabsTrigger value="profile">画像</TabsTrigger>
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

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">暂无时段数据</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHeader<HourlySortRow> label="时段" sortKey="hour" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          <SortableHeader<HourlySortRow> label="来源" sortKey="client" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} />
          {hasTurns && <SortableHeader<HourlySortRow> label="轮次" sortKey="turns" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />}
          <SortableHeader<HourlySortRow> label="输入" sortKey="input" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="输出" sortKey="output" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="缓存读" sortKey="cacheRead" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="缓存写" sortKey="cacheWrite" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="缓存率" sortKey="cacheHitRate" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          {hasReasoning && <SortableHeader<HourlySortRow> label="推理" sortKey="reasoning" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />}
          <SortableHeader<HourlySortRow> label="合计" sortKey="total" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="消息" sortKey="messages" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
          <SortableHeader<HourlySortRow> label="费用" sortKey="cost" currentKey={sortKey} currentDir={sortDir} onToggle={toggleSort} className="text-right" />
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

const PERIOD_NAME_MAP: Record<string, string> = {
  Morning: "上午",
  Daytime: "下午",
  Evening: "傍晚",
  Night: "夜间",
}

function HourlyProfileView({ profile }: { profile: HourlyProfile | null }) {
  if (!profile) return <p className="text-muted-foreground text-sm">暂无时段数据</p>

  const maxPeriodTokens = Math.max(...profile.periods.map((p) => p.tokens))

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-medium">工作时段分布</h3>
        <div className="grid grid-cols-4 gap-3">
          {profile.periods.map((p) => {
            const isPeak = p.tokens === maxPeriodTokens && p.tokens > 0
            return (
              <div key={p.name} className="rounded-lg bg-muted p-4 space-y-3">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-sm font-medium ${isPeak ? "text-primary" : ""}`}>
                    {PERIOD_NAME_MAP[p.name] || p.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {String(p.startHour).padStart(2, "0")}:00–{String(p.endHour % 24).padStart(2, "0")}:00
                  </span>
                </div>
                <div className="space-y-0.5">
                  <div className={`text-lg font-semibold tabular-nums ${isPeak ? "text-primary" : ""}`}>
                    {formatTokens(p.tokens)} Token
                  </div>
                  <div className="text-muted-foreground text-sm">{formatCost(p.cost)}</div>
                  <div className="text-muted-foreground text-sm">{p.messages.toLocaleString()} 条消息</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium">每周用量分布</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={profile.weekdays} layout="vertical">
            <XAxis type="number" tickFormatter={(v: number) => formatTokens(v)} />
            <YAxis type="category" dataKey="day" width={36} interval={0} />
            <Tooltip formatter={(value) => [formatTokens(Number(value)), "Token"]} />
            <Bar dataKey="tokens" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-sm text-muted-foreground">
        高峰时段：<span className="font-medium text-foreground">{profile.peakHour}:00</span>
        {profile.peakHourTokens > 0 && (
          <span> — {formatTokens(profile.peakHourTokens)} Token</span>
        )}
      </p>
    </div>
  )
}
