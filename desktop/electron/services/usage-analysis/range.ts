import type { UsageRangeFilter, UsageRangeInput } from "./types"

const DAY_MS = 24 * 60 * 60 * 1000

const RANGE_DAYS: Record<Exclude<UsageRangeInput["preset"], "today" | "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

export function localDateKey(timestampMs: number): string {
  const date = new Date(timestampMs)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function localHourKey(timestampMs: number): string {
  const date = new Date(timestampMs)
  return `${localDateKey(timestampMs)} ${pad2(date.getHours())}`
}

export function createUsageRangeFilter(input: UsageRangeInput, now = new Date()): UsageRangeFilter {
  if (input.preset === "all") return {}
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (input.preset === "today") {
    const today = localDateKey(end.getTime())
    return {
      sinceDate: today,
      untilDate: today,
    }
  }
  const days = RANGE_DAYS[input.preset]
  const start = new Date(end.getTime() - (days - 1) * DAY_MS)
  return {
    sinceDate: localDateKey(start.getTime()),
    untilDate: localDateKey(end.getTime()),
  }
}
