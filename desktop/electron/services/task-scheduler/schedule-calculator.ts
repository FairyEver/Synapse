import { nextCronRun } from "./cron-expression"
import type { TaskTrigger } from "./types"

const MAX_ADVANCE_ITERATIONS = 7

export function computeNextRunAt(input: {
  readonly trigger: TaskTrigger
  readonly from: Date
  readonly createdAt: string
  readonly activeDays?: readonly number[]
}): Date {
  const activeDays = input.activeDays && input.activeDays.length < 7
    ? new Set(input.activeDays)
    : null

  if (!activeDays) return computeRawCandidate(input)

  let candidate = computeRawCandidate(input)

  for (let i = 0; i < MAX_ADVANCE_ITERATIONS; i++) {
    const weekday = getWeekday(candidate, input.trigger)
    if (activeDays.has(weekday)) return candidate
    const nextDay = advanceToNextValidDay(candidate, activeDays, input.trigger)
    candidate = computeRawCandidate({ ...input, from: nextDay })
  }

  return candidate
}

function computeRawCandidate(input: {
  readonly trigger: TaskTrigger
  readonly from: Date
  readonly createdAt: string
}): Date {
  if (input.trigger.type === "builtin.cron") {
    return nextCronRun(input.trigger.config.expr, input.from, input.trigger.config.timezone)
  }
  const everyMs = input.trigger.config.everyMinutes * 60_000
  if (input.trigger.config.anchor === "last_completed_at") {
    return new Date(input.from.getTime() + everyMs)
  }
  const anchor = new Date(input.createdAt).getTime()
  const from = input.from.getTime()
  const elapsed = Math.max(0, from - anchor)
  const steps = Math.floor(elapsed / everyMs) + 1
  return new Date(anchor + steps * everyMs)
}

function getWeekday(date: Date, trigger: TaskTrigger): number {
  if (trigger.type === "builtin.cron") {
    if (trigger.config.timezone) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: trigger.config.timezone,
        weekday: "short",
      }).formatToParts(date)
      const weekdayPart = parts.find((p) => p.type === "weekday")
      const dayMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      }
      return dayMap[weekdayPart?.value ?? ""] ?? date.getUTCDay()
    }
    // Local-time cron: use local weekday (matches nextCronRunLocal behavior)
    return date.getDay()
  }
  // Interval triggers: use UTC weekday
  return date.getUTCDay()
}

function advanceToNextValidDay(
  date: Date,
  activeDays: ReadonlySet<number>,
  trigger: TaskTrigger,
): Date {
  if (trigger.type === "builtin.cron" && trigger.config.timezone) {
    const timezone = trigger.config.timezone
    // Get current wall-clock date in the timezone
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour12: false,
    }).formatToParts(date)
    const obj: Record<string, string> = {}
    for (const p of parts) {
      if (p.type !== "literal") obj[p.type] = p.value
    }
    let year = Number(obj.year)
    let month = Number(obj.month)
    let day = Number(obj.day)

    // Advance day-by-day until we find a valid weekday
    for (let i = 0; i < MAX_ADVANCE_ITERATIONS; i++) {
      day += 1
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
      if (day > daysInMonth) {
        day = 1
        month += 1
        if (month > 12) {
          month = 1
          year += 1
        }
      }
      const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
      if (activeDays.has(dow)) {
        // Return 1 minute before midnight in the timezone so nextCronRun finds the first match on this day
        const midnightUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0)
        const offset = getTimezoneOffsetMs(new Date(midnightUtcMs), timezone)
        return new Date(midnightUtcMs - offset - 60_000)
      }
    }
  } else if (trigger.type === "builtin.cron") {
    // Local-time cron: advance using local dates
    const d = new Date(date)
    for (let i = 0; i < MAX_ADVANCE_ITERATIONS; i++) {
      d.setDate(d.getDate() + 1)
      if (activeDays.has(d.getDay())) {
        // Return 1 minute before local midnight so nextCronRunLocal finds the first match on this day
        const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)
        return new Date(localMidnight.getTime() - 60_000)
      }
    }
  } else {
    // Interval triggers: advance using UTC dates
    const d = new Date(date)
    for (let i = 0; i < MAX_ADVANCE_ITERATIONS; i++) {
      d.setUTCDate(d.getUTCDate() + 1)
      if (activeDays.has(d.getUTCDay())) {
        // Return 1 minute before UTC midnight so interval computation starts from this day
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0) - 60_000)
      }
    }
  }

  return date
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
    hour12: false,
  }).formatToParts(date)
  const offsetPart = parts.find((p) => p.type === "timeZoneName")
  if (offsetPart) {
    const match = offsetPart.value.match(/GMT([+-]\d{2}):?(\d{2})/)
    if (match) {
      const sign = match[1]![0] === "+" ? 1 : -1
      return sign * (Number(match[1]!.slice(1)) * 60 + Number(match[2]!)) * 60_000
    }
  }
  return 0
}

export function resolveStartupSchedule(input: {
  readonly enabled: boolean
  readonly nextRunAt?: string
  readonly missedRunPolicy: "skip" | "run_once"
  readonly trigger: TaskTrigger
  readonly createdAt: string
  readonly now: Date
}): { readonly action: "none" | "schedule_next" | "run_missed_once" } {
  if (!input.enabled) return { action: "none" }
  if (!input.nextRunAt) return { action: "schedule_next" }
  const nextRunAt = new Date(input.nextRunAt)
  const nextRunAtTime = nextRunAt.getTime()
  if (!Number.isFinite(nextRunAtTime)) return { action: "schedule_next" }
  if (nextRunAtTime > input.now.getTime()) return { action: "schedule_next" }
  return input.missedRunPolicy === "run_once"
    ? { action: "run_missed_once" }
    : { action: "schedule_next" }
}
