import { clockOffsetMs, offsetsAroundDay, sameWallDay, sameWallMinute } from "./schedule-clock"
import { matchesDayFields, nextCronRun, parseCronExpression } from "./cron-expression"
import {
  createScheduleClockReader,
  isAutomationConditionsSatisfied,
  timeOfDayMinutes,
  type AutomationCondition,
  type AutomationConditions,
  type AutomationTimeRange,
  type ScheduleClock,
} from "./schedule-constraints"


export type AutomationTimeTrigger =
  | {
      readonly type: "builtin.cron"
      readonly config: {
        readonly expr: string
        readonly timezone?: string
      }
    }
  | {
      readonly type: "builtin.interval"
      readonly config: {
        readonly everyMinutes: number
        readonly anchor: "created_at" | "last_completed_at"
      }
    }

export function computeNextRunAt(input: {
  readonly trigger: AutomationTimeTrigger
  readonly conditions?: AutomationConditions
  readonly from: Date
  readonly createdAt: string
}): Date | null {
  const conditions = input.conditions
  if (!conditions?.items.length) return computeRawCandidate(input)
  if (conditions.items.length === 1) return computeConditionNextRunAt(input, conditions.items[0]!)

  const weekdays = conditions.items.find((condition) => condition.type === "weekdays")
  const timeRange = conditions.items.find((condition) => condition.type === "daily-time-range")
  const activeDays = weekdays?.days ?? ALL_DAYS

  if (conditions.operator === "and") {
    if (timeRange) {
      return computeWindowedNextRunAt(input, activeDays, {
        start: timeRange.start,
        end: timeRange.end,
      })
    }
    return computeActiveDaysNextRunAt(input, activeDays)
  }

  const candidates = conditions.items
    .map((condition) => computeConditionNextRunAt(input, condition))
    .filter((candidate): candidate is Date => candidate !== null)
  if (!candidates.length) return null
  return new Date(Math.min(...candidates.map((candidate) => candidate.getTime())))
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const

function computeConditionNextRunAt(
  input: {
    readonly trigger: AutomationTimeTrigger
    readonly from: Date
    readonly createdAt: string
  },
  condition: AutomationCondition,
): Date | null {
  if (condition.type === "weekdays") return computeActiveDaysNextRunAt(input, condition.days)
  return computeWindowedNextRunAt(input, ALL_DAYS, {
    start: condition.start,
    end: condition.end,
  })
}

function computeActiveDaysNextRunAt(
  input: { readonly trigger: AutomationTimeTrigger; readonly from: Date; readonly createdAt: string },
  days: readonly number[],
): Date | null {
  if (days.length >= 7) return computeRawCandidate(input)
  return computeWindowedNextRunAt(input, days, { start: "00:00", end: "24:00" })
}

function computeWindowedNextRunAt(input: {
  readonly trigger: AutomationTimeTrigger
  readonly conditions?: AutomationConditions
  readonly from: Date
  readonly createdAt: string
}, activeDays: readonly number[], range: AutomationTimeRange): Date | null {
  const { trigger, from } = input
  const startMinute = timeOfDayMinutes(range.start)
  const endMinute = timeOfDayMinutes(range.end)
  const timezone = triggerTimezone(trigger)
  const readClock = createScheduleClockReader(timezone)
  const end = new Date(from)
  end.setFullYear(end.getFullYear() + 5)
  const endMs = end.getTime()
  const first = readClock(from)
  const day = new Date(Date.UTC(first.year, first.month - 1, first.day))
  const last = readClock(end)
  const lastDay = Date.UTC(last.year, last.month - 1, last.day)
  const parsed = trigger.type === "builtin.cron" ? parseCronExpression(trigger.config.expr) : null
  const minutes = parsed
    ? Array.from({ length: endMinute - startMinute }, (_, i) => startMinute + i)
      .filter((minute) => parsed.hour.has(Math.floor(minute / 60)) && parsed.minute.has(minute % 60))
    : []
  if (parsed && minutes.length === 0) return null

  // Keep a single interval origin throughout the search, including skipped days.
  const rawCandidate = trigger.type === "builtin.interval" ? computeRawCandidate(input) : null
  if (trigger.type === "builtin.interval" && !rawCandidate) return null
  const origin = rawCandidate?.getTime() ?? 0
  const everyMs = trigger.type === "builtin.interval" ? trigger.config.everyMinutes * 60_000 : 0
  if (!parsed) {
    if (origin > endMs) return null
    const candidate = new Date(origin)
    if (isScheduleWindowAllowed(candidate, activeDays, range, timezone)) return candidate
  }

  for (; day.getTime() <= lastDay; day.setUTCDate(day.getUTCDate() + 1)) {
    if (!activeDays.includes(day.getUTCDay())) continue
    if (parsed && (!parsed.month.has(day.getUTCMonth() + 1) ||
      !matchesDayFields(parsed, day.getUTCDate(), day.getUTCDay()))) continue
    const offsets = offsetsAroundDay(day, readClock)
    let earliest = Infinity
    const dailyMinutes = parsed ? minutes : intervalWindowMinutes(day, startMinute, endMinute, offsets, readClock)
    for (const minute of dailyMinutes) {
      for (const offset of offsets) {
        const instant = day.getTime() + minute * 60_000 - offset
        if ((parsed && instant <= from.getTime()) || instant > endMs || instant >= earliest) continue
        const clock = readClock(new Date(instant))
        // Nonexistent spring-forward times must not be shifted into another hour.
        if (!sameWallMinute(clock, day, minute)) continue
        if (parsed) {
          earliest = instant
        } else {
          const aligned = origin + Math.max(0, Math.ceil((instant - origin) / everyMs)) * everyMs
          if (aligned >= earliest || aligned > endMs) continue
          const alignedDate = new Date(aligned)
          const alignedClock = readClock(alignedDate)
          if (sameWallDay(alignedClock, day) && isScheduleWindowAllowed(alignedDate, activeDays, range, timezone)) {
            earliest = aligned
          }
        }
      }
    }
    if (earliest !== Infinity) return new Date(earliest)
  }
  return null
}

function triggerTimezone(trigger: AutomationTimeTrigger): string | undefined {
  return trigger.type === "builtin.cron" ? trigger.config.timezone : undefined
}

function isScheduleWindowAllowed(
  date: Date,
  activeDays: readonly number[],
  range: AutomationTimeRange,
  timezone: string | undefined,
): boolean {
  return isAutomationConditionsSatisfied(date, {
    operator: "and",
    items: [
      { type: "weekdays", days: [...activeDays] },
      { type: "daily-time-range", start: range.start, end: range.end },
    ],
  }, timezone)
}

function intervalWindowMinutes(
  day: Date,
  startMinute: number,
  endMinute: number,
  offsets: ReadonlySet<number>,
  readClock: (date: Date) => ScheduleClock,
): number[] {
  const minutes = new Set([startMinute])
  if (offsets.size === 1) return [...minutes]
  // Clock changes can open an additional segment of the daily window: e.g.
  // 02:10–04:00 starts at 03:00 after a spring gap, and a fall fold reopens 01:00.
  let left = day.getTime() - 36 * 3_600_000
  let previousOffset = clockOffsetMs(left, readClock)
  for (const hours of [-12, 12, 36]) {
    const right = day.getTime() + hours * 3_600_000
    const nextOffset = clockOffsetMs(right, readClock)
    if (previousOffset !== nextOffset) {
      let low = left
      let high = right
      while (high - low > 60_000) {
        const middle = Math.floor((low + high) / 120_000) * 60_000
        if (clockOffsetMs(middle, readClock) === previousOffset) low = middle
        else high = middle
      }
      const clock = readClock(new Date(high))
      if (sameWallDay(clock, day) && clock.minute >= startMinute && clock.minute < endMinute) {
        minutes.add(clock.minute)
      }
    }
    left = right
    previousOffset = nextOffset
  }
  return [...minutes]
}

function computeRawCandidate(input: {
  readonly trigger: AutomationTimeTrigger
  readonly from: Date
  readonly createdAt: string
}): Date | null {
  if (input.trigger.type === "builtin.cron") {
    return nextCronRun(input.trigger.config.expr, input.from, input.trigger.config.timezone)
  }
  const everyMs = input.trigger.config.everyMinutes * 60_000
  if (input.trigger.config.anchor === "last_completed_at") {
    const candidate = new Date(input.from.getTime() + everyMs)
    return Number.isFinite(candidate.getTime()) ? candidate : null
  }
  const anchor = new Date(input.createdAt).getTime()
  const from = input.from.getTime()
  const elapsed = Math.max(0, from - anchor)
  const steps = Math.floor(elapsed / everyMs) + 1
  const candidate = new Date(anchor + steps * everyMs)
  return Number.isFinite(candidate.getTime()) ? candidate : null
}
