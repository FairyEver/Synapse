import { useState, useCallback } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { formatTokens } from "../lib/format"
import { getProviderColorVariable } from "../lib/colors"
import type { GraphResult } from "../hooks/use-token-usage"

type Contribution = GraphResult["contributions"][number]

interface StackedBarChartProps {
  contributions: Contribution[]
}

export function StackedBarChart({ contributions }: StackedBarChartProps) {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set())

  const nonEmpty = contributions.filter((c) => c.totals.tokens > 0)

  const modelTotals = new Map<string, { total: number; providerId: string }>()
  for (const c of nonEmpty) {
    for (const cl of c.clients) {
      const total = cl.tokens.input + cl.tokens.output + cl.tokens.cacheRead + cl.tokens.cacheWrite + cl.tokens.reasoning
      const existing = modelTotals.get(cl.modelId) || { total: 0, providerId: cl.providerId }
      existing.total += total
      modelTotals.set(cl.modelId, existing)
    }
  }

  const sorted = [...modelTotals.entries()].sort((a, b) => b[1].total - a[1].total)
  const topModels = sorted.slice(0, 8).map(([id]) => id)

  const chartData = nonEmpty.map((c) => {
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
    modelColors.set(id, getProviderColorVariable(info.providerId))
  }
  modelColors.set("other", "var(--muted)")

  const barKeys = [...topModels, ...(sorted.length > 8 ? ["other"] : [])]

  const handleLegendClick = useCallback((dataKey: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(dataKey)) next.delete(dataKey)
      else next.add(dataKey)
      return next
    })
  }, [])

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={formatTokens} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(value) => formatTokens(Number(value))} />
        <Legend
          onClick={(e) => handleLegendClick(String(e.dataKey))}
          wrapperStyle={{ cursor: "pointer" }}
        />
        {barKeys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            stackId="tokens"
            fill={modelColors.get(key) || "var(--muted)"}
            hide={hiddenKeys.has(key)}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
