import { useState } from "react"
import { StackedBarChart } from "./stacked-bar-chart"
import { formatTokens, formatCost, formatPercent, formatCacheRatio } from "../lib/format"
import { getProviderColor } from "../lib/colors"
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
        No usage data yet. Click Refresh to scan.
      </div>
    )
  }

  const modelMap = new Map<string, { providerId: string; tokens: number; cost: number }>()
  let totalCacheRead = 0
  let totalInput = 0
  let totalCacheWrite = 0
  for (const c of contributions) {
    for (const cl of c.clients) {
      const total = cl.tokens.input + cl.tokens.output + cl.tokens.cacheRead + cl.tokens.cacheWrite + cl.tokens.reasoning
      const existing = modelMap.get(cl.modelId) || { providerId: cl.providerId, tokens: 0, cost: 0 }
      existing.tokens += total
      existing.cost += cl.cost
      modelMap.set(cl.modelId, existing)
      totalCacheRead += cl.tokens.cacheRead
      totalInput += cl.tokens.input
      totalCacheWrite += cl.tokens.cacheWrite
    }
  }
  const topModels = [...modelMap.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 10)

  const stats = [
    { label: "Total tokens", value: formatTokens(summary.totalTokens) },
    { label: "Total cost", value: formatCost(summary.totalCost) },
    { label: "Active days", value: String(summary.activeDays) },
    { label: "Cache ratio", value: formatCacheRatio(totalCacheRead, totalInput, totalCacheWrite) },
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
          Tokens per {granularity === "daily" ? "Day" : "Hour"}
        </h3>
        <Tabs value={granularity} onValueChange={(v) => setGranularity(v as "daily" | "hourly")}>
          <TabsList className="h-7">
            <TabsTrigger value="daily" className="text-xs">Daily</TabsTrigger>
            <TabsTrigger value="hourly" className="text-xs">Hourly</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <StackedBarChart contributions={chartContributions} />
      <div>
        <h3 className="mb-2 text-sm font-medium">Top Models</h3>
        <div className="space-y-1">
          {topModels.map(([modelId, info], i) => (
            <div key={modelId} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground w-5 text-right">{i + 1}</span>
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: getProviderColor(info.providerId) }}
              />
              <span className="flex-1 truncate">{modelId}</span>
              <span className="text-muted-foreground">{formatPercent(info.tokens, summary.totalTokens)}</span>
              <span className="w-20 text-right">{formatTokens(info.tokens)}</span>
              <span className="text-muted-foreground w-16 text-right">{formatCost(info.cost)}</span>
            </div>
          ))}
        </div>
      </div>
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
