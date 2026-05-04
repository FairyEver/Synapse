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

export function StatsView({ graphResult }: StatsViewProps) {
  const { summary, contributions } = graphResult
  const streaks = calculateStreak(contributions)

  const contribDays = contributions.map((c) => ({
    date: c.date,
    tokens: c.totals.tokens,
    intensity: c.intensity,
  }))

  const stats = [
    { label: "Active days", value: String(summary.activeDays) },
    { label: "Current streak", value: `${streaks.current} days` },
    { label: "Longest streak", value: `${streaks.longest} days` },
    { label: "Total tokens", value: formatTokens(summary.totalTokens) },
    { label: "Total cost", value: formatCost(summary.totalCost) },
    { label: "Avg per day", value: formatTokens(summary.averagePerDay) },
    { label: "Models used", value: String(summary.models.length) },
  ]

  return (
    <div className="flex flex-col gap-6">
      <ContributionGraph contributions={contribDays} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-lg font-medium">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
