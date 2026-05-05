import { useState, useMemo } from "react"
import { ContributionGraph } from "./contribution-graph"
import { formatTokens, formatCost } from "../lib/format"
import type { GraphResult } from "../hooks/use-token-usage"

interface StatsViewProps {
  graphResult: GraphResult
}

function calculateStreak(contributions: GraphResult["contributions"]): {
  current: number; longest: number
} {
  const sorted = [...contributions].sort((a, b) => a.date.localeCompare(b.date))
  let current = 0
  let longest = 0
  let streak = 0

  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].totals.tokens > 0) {
      streak++
      longest = Math.max(longest, streak)
    } else {
      if (current === 0) current = streak
      streak = 0
    }
  }
  if (current === 0) current = streak

  return { current, longest: Math.max(longest, streak) }
}

function findFavoriteModel(contributions: GraphResult["contributions"]): string {
  const counts = new Map<string, number>()
  for (const c of contributions) {
    for (const cl of c.clients) {
      counts.set(cl.modelId, (counts.get(cl.modelId) || 0) + cl.messages)
    }
  }
  let best = ""
  let bestCount = 0
  for (const [model, count] of counts) {
    if (count > bestCount) { best = model; bestCount = count }
  }
  return best || "—"
}

function findBestDay(contributions: GraphResult["contributions"]): { date: string; cost: number } | null {
  if (contributions.length === 0) return null
  const best = contributions.reduce((b, c) => c.totals.cost > b.totals.cost ? c : b)
  return { date: best.date, cost: best.totals.cost }
}

export function StatsView({ graphResult }: StatsViewProps) {
  const { summary, contributions } = graphResult
  const streaks = calculateStreak(contributions)
  const favoriteModel = useMemo(() => findFavoriteModel(contributions), [contributions])
  const bestDay = useMemo(() => findBestDay(contributions), [contributions])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const contribDays = contributions.map((c) => ({
    date: c.date,
    tokens: c.totals.tokens,
    intensity: c.intensity,
  }))

  const selectedDayData = useMemo(() => {
    if (!selectedDate) return null
    return contributions.find((c) => c.date === selectedDate) || null
  }, [selectedDate, contributions])

  const stats = [
    { label: "活跃天数", value: String(summary.activeDays) },
    { label: "当前连续", value: `${streaks.current} 天` },
    { label: "最长连续", value: `${streaks.longest} 天` },
    { label: "总 Token", value: formatTokens(summary.totalTokens) },
    { label: "总费用", value: formatCost(summary.totalCost) },
    { label: "日均用量", value: formatTokens(summary.averagePerDay) },
    { label: "使用模型数", value: String(summary.models.length) },
    { label: "最常用模型", value: favoriteModel },
    { label: "用量最高日", value: bestDay ? bestDay.date : "—", subValue: bestDay ? formatCost(bestDay.cost) : undefined },
  ]

  return (
    <div className="flex flex-col gap-6">
      <ContributionGraph
        contributions={contribDays}
        selectedDate={selectedDate}
        onDateClick={setSelectedDate}
      />

      {selectedDayData && (
        <div className="rounded-md border p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">{selectedDayData.date}</span>
            <span className="text-muted-foreground text-sm">
              {formatTokens(selectedDayData.totals.tokens)} Token · {formatCost(selectedDayData.totals.cost)}
            </span>
          </div>
          <div className="space-y-1">
            {selectedDayData.clients.map((cl, i) => (
              <div key={`${cl.client}-${cl.modelId}-${i}`} className="flex items-center justify-between text-sm">
                <span>
                  <span className="text-muted-foreground">{cl.client}</span>
                  <span className="mx-1">·</span>
                  <span>{cl.modelId}</span>
                </span>
                <span className="text-muted-foreground">
                  {formatTokens(cl.tokens.input + cl.tokens.output + cl.tokens.cacheRead + cl.tokens.cacheWrite + cl.tokens.reasoning)}
                  <span className="mx-1">·</span>
                  {formatCost(cl.cost)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border p-3">
            <div className="text-muted-foreground text-xs">{s.label}</div>
            <div className="text-lg font-medium">{s.value}</div>
            {s.subValue && <div className="text-muted-foreground text-xs">{s.subValue}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
