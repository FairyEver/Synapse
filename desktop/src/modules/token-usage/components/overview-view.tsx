import { useState } from "react"
import { StackedBarChart } from "./stacked-bar-chart"
import { formatTokens, formatCost, formatCacheRatio } from "../lib/format"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { GraphResult, HourlyRow } from "../hooks/use-token-usage"

interface OverviewViewProps {
  graphResult: GraphResult
  hourlyRows?: HourlyRow[]
}

export function OverviewView({ graphResult, hourlyRows = [] }: OverviewViewProps) {
  const { summary, contributions } = graphResult
  const [granularity, setGranularity] = useState<"daily" | "hourly">("daily")

  if (summary.totalTokens === 0) {
    return (
      <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
        暂无用量数据，点击刷新扫描
      </div>
    )
  }

  let totalCacheRead = 0
  let totalInput = 0
  let totalCacheWrite = 0
  for (const c of contributions) {
    totalCacheRead += c.tokenBreakdown.cacheRead
    totalInput += c.tokenBreakdown.input
    totalCacheWrite += c.tokenBreakdown.cacheWrite
  }

  const stats = [
    { label: "总 Token", value: formatTokens(summary.totalTokens) },
    { label: "总费用", value: formatCost(summary.totalCost) },
    { label: "活跃天数", value: String(summary.activeDays) },
    { label: "缓存命中率", value: formatCacheRatio(totalCacheRead, totalInput, totalCacheWrite) },
  ]

  const hourlyContributions = hourlyRows.length > 0 ? buildHourlyContributions(hourlyRows) : []
  const chartContributions = granularity === "hourly" && hourlyContributions.length > 0
    ? hourlyContributions
    : contributions

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">{s.label}</div>
            <div className="text-lg font-medium">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Token 趋势（{granularity === "daily" ? "按天" : "按小时"}）
        </h3>
        <Tabs value={granularity} onValueChange={(v) => setGranularity(v as "daily" | "hourly")}>
          <TabsList className="h-7">
            <TabsTrigger value="daily" className="text-xs">按天</TabsTrigger>
            <TabsTrigger value="hourly" className="text-xs">按小时</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <StackedBarChart contributions={chartContributions} />
    </div>
  )
}

function buildHourlyContributions(rows: HourlyRow[]): GraphResult["contributions"] {
  const byHour = new Map<string, GraphResult["contributions"][number]>()
  for (const r of rows) {
    const existing = byHour.get(r.hour)
    const tokens = r.input + r.output + r.cacheRead + r.cacheWrite + r.reasoning
    const client = {
      client: r.client, modelId: r.model, providerId: r.provider,
      tokens: { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite, reasoning: r.reasoning },
      cost: r.cost, messages: r.messages,
    }
    if (existing) {
      existing.totals.tokens += tokens
      existing.totals.cost += r.cost
      existing.totals.messages += r.messages
      existing.tokenBreakdown.input += r.input
      existing.tokenBreakdown.output += r.output
      existing.tokenBreakdown.cacheRead += r.cacheRead
      existing.tokenBreakdown.cacheWrite += r.cacheWrite
      existing.tokenBreakdown.reasoning += r.reasoning
      existing.clients.push(client)
    } else {
      byHour.set(r.hour, {
        date: r.hour,
        totals: { tokens, cost: r.cost, messages: r.messages },
        intensity: 0 as 0 | 1 | 2 | 3 | 4,
        tokenBreakdown: { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite, reasoning: r.reasoning },
        clients: [client],
      })
    }
  }
  return [...byHour.values()].sort((a, b) => a.date.localeCompare(b.date))
}
