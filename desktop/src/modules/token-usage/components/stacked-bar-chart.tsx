import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"
import { formatTokens } from "../lib/format"
import { getProviderColor } from "../lib/colors"
import type { GraphResult } from "../hooks/use-token-usage"

type Contribution = GraphResult["contributions"][number]

interface StackedBarChartProps {
  contributions: Contribution[]
}

export function StackedBarChart({ contributions }: StackedBarChartProps) {
  const modelTotals = new Map<string, { total: number; providerId: string }>()
  for (const c of contributions) {
    for (const cl of c.clients) {
      const total = cl.tokens.input + cl.tokens.output + cl.tokens.cacheRead + cl.tokens.cacheWrite + cl.tokens.reasoning
      const existing = modelTotals.get(cl.modelId) || { total: 0, providerId: cl.providerId }
      existing.total += total
      modelTotals.set(cl.modelId, existing)
    }
  }

  const sorted = [...modelTotals.entries()].sort((a, b) => b[1].total - a[1].total)
  const topModels = sorted.slice(0, 8).map(([id]) => id)

  const chartData = contributions.map((c) => {
    const entry: Record<string, unknown> = { date: c.date.slice(5) }
    for (const cl of c.clients) {
      const total = cl.tokens.input + cl.tokens.output + cl.tokens.cacheRead + cl.tokens.cacheWrite + cl.tokens.reasoning
      const key = topModels.includes(cl.modelId) ? cl.modelId : "other"
      entry[key] = ((entry[key] as number) || 0) + total
    }
    return entry
  })

  const modelColors = new Map<string, string>()
  for (const [id, info] of modelTotals) {
    modelColors.set(id, getProviderColor(info.providerId))
  }
  modelColors.set("other", "#888888")

  const barKeys = [...topModels, ...(sorted.length > 8 ? ["other"] : [])]

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={formatTokens} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => formatTokens(Number(value))} />
        {barKeys.map((key) => (
          <Bar key={key} dataKey={key} stackId="tokens" fill={modelColors.get(key) || "#888"} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
