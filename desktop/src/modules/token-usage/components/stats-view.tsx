import { useMemo } from "react"
import { formatTokens, formatCost } from "../lib/format"
import type { GraphResult } from "../hooks/use-token-usage"

interface StatsViewProps {
  graphResult: GraphResult
}

function calculateStreak(contributions: GraphResult["contributions"]): {
  current: number; longest: number
} {
  const activeDays = [...new Set(contributions
    .filter((item) => item.totals.tokens > 0)
    .map((item) => dateToDayIndex(item.date))
    .filter((dayIndex): dayIndex is number => dayIndex !== null))]
    .sort((a, b) => a - b)

  if (activeDays.length === 0) return { current: 0, longest: 0 }

  let longest = 0
  let streak = 0
  let previousDay: number | null = null

  for (const day of activeDays) {
    if (previousDay !== null && day === previousDay + 1) {
      streak++
    } else {
      streak = 1
    }
    longest = Math.max(longest, streak)
    previousDay = day
  }

  const today = dateToDayIndex(new Date())
  const latestDay = activeDays[activeDays.length - 1]
  if (today === null || latestDay < today - 1 || latestDay > today) {
    return { current: 0, longest }
  }

  let current = 1
  for (let i = activeDays.length - 2; i >= 0; i--) {
    if (activeDays[i] !== latestDay - current) break
    current++
  }

  return { current, longest }
}

function dateToDayIndex(value: string | Date): number | null {
  const date = value instanceof Date ? getLocalDateParts(value) : parseDateString(value)
  if (!date) return null
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000)
}

function parseDateString(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return { year, month, day }
}

function getLocalDateParts(date: Date): { year: number; month: number; day: number } {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }
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
    <div>
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
