import { matchesDayFields, nextCronRun, parseCronExpression } from "./cron-expression"
import {
  createScheduleClockReader,
  isAutomationScheduleAllowed,
  timeOfDayMinutes,
  type AutomationTimeRange,
  type ScheduleClock,
} from "../../../automation-trigger-packages/schedule-constraints"

const MAX_ADVANCE_ITERATIONS = 7

export type AutomationTimeTrigger =
  | {
      readonly type: "builtin.cron"
      readonly config: {
        readonly expr: string
        readonly timezone?: string
        readonly activeDays: readonly number[]
        readonly timeRange?: AutomationTimeRange
      }
    }
  | {
      readonly type: "builtin.interval"
      readonly config: {
        readonly everyMinutes: number
        readonly anchor: "created_at" | "last_completed_at"
        readonly activeDays: readonly number[]
        readonly timeRange?: AutomationTimeRange
      }
    }

export function computeNextRunAt(input: {
  readonly trigger: AutomationTimeTrigger
  readonly from: Date
  readonly createdAt: string
}): Date | null {
  if (input.trigger.config.timeRange) return computeWindowedNextRunAt(input)
  const activeDays = input.trigger.config.activeDays.length < 7
    ? new Set(input.trigger.config.activeDays)
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

function computeWindowedNextRunAt(input: {
  readonly trigger: AutomationTimeTrigger
  readonly from: Date
  readonly createdAt: string
}): Date | null {
  const { trigger, from } = input
  const range = trigger.config.timeRange!
  const startMinute = timeOfDayMinutes(range.start)
  const endMinute = timeOfDayMinutes(range.end)
  const timezone = trigger.type === "builtin.cron" ? trigger.config.timezone : undefined
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
  const origin = trigger.type === "builtin.interval" ? computeRawCandidate(input).getTime() : 0
  const everyMs = trigger.type === "builtin.interval" ? trigger.config.everyMinutes * 60_000 : 0
  if (!parsed) {
    if (origin > endMs) return null
    const candidate = new Date(origin)
    if (isAutomationScheduleAllowed(candidate, trigger.config)) return candidate
  }

  for (; day.getTime() <= lastDay; day.setUTCDate(day.getUTCDate() + 1)) {
    if (!trigger.config.activeDays.includes(day.getUTCDay())) continue
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
          if (sameWallDay(alignedClock, day) && isAutomationScheduleAllowed(alignedDate, trigger.config)) {
            earliest = aligned
          }
        }
      }
    }
    if (earliest !== Infinity) return new Date(earliest)
  }
  return null
}

function sameWallDay(clock: ScheduleClock, day: Date): boolean {
  return clock.year === day.getUTCFullYear() && clock.month === day.getUTCMonth() + 1 && clock.day === day.getUTCDate()
}

function sameWallMinute(clock: ScheduleClock, day: Date, minute: number): boolean {
  return sameWallDay(clock, day) && clock.minute === minute
}

function offsetsAroundDay(day: Date, readClock: (date: Date) => ScheduleClock): Set<number> {
  const offsets = new Set<number>()
  // Probe both sides of local clock changes so repeated minutes retain both instants.
  for (const hours of [-36, -12, 12, 36]) {
    const probe = day.getTime() + hours * 3_600_000
    offsets.add(clockOffsetMs(probe, readClock))
  }
  return offsets
}

function clockOffsetMs(instant: number, readClock: (date: Date) => ScheduleClock): number {
  const clock = readClock(new Date(instant))
  return Date.UTC(clock.year, clock.month - 1, clock.day) + clock.minute * 60_000 - instant
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

function getWeekday(date: Date, trigger: AutomationTimeTrigger): number {
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
    return date.getDay()
  }
  return date.getDay()
}

function advanceToNextValidDay(
  date: Date,
  activeDays: ReadonlySet<number>,
  trigger: AutomationTimeTrigger,
): Date {
  if (trigger.type === "builtin.cron" && trigger.config.timezone) {
    const timezone = trigger.config.timezone
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
        const midnightUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0)
        const offset = getTimezoneOffsetMs(new Date(midnightUtcMs), timezone)
        return new Date(midnightUtcMs - offset - 60_000)
      }
    }
  } else if (trigger.type === "builtin.cron") {
    const d = new Date(date)
    for (let i = 0; i < MAX_ADVANCE_ITERATIONS; i++) {
      d.setDate(d.getDate() + 1)
      if (activeDays.has(d.getDay())) {
        const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)
        return new Date(localMidnight.getTime() - 60_000)
      }
    }
  } else {
    const d = new Date(date)
    for (let i = 0; i < MAX_ADVANCE_ITERATIONS; i++) {
      d.setDate(d.getDate() + 1)
      if (activeDays.has(d.getDay())) {
        const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)
        return new Date(localMidnight.getTime() - 60_000)
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
