import { createScheduleClockReader } from "./schedule-constraints"
import { offsetsAroundDay, sameWallMinute } from "./schedule-clock"

export interface ParsedCronExpression {
  readonly minute: ReadonlySet<number>
  readonly hour: ReadonlySet<number>
  readonly day: ReadonlySet<number>
  readonly month: ReadonlySet<number>
  readonly weekday: ReadonlySet<number>
  readonly dayWildcard: boolean
  readonly weekdayWildcard: boolean
}

interface FieldSpec {
  readonly name: string
  readonly min: number
  readonly max: number
  readonly aliases?: Record<string, number>
  readonly normalize?: (value: number) => number
}

const MONTH_ALIASES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const FIELD_SPECS: readonly FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, aliases: MONTH_ALIASES },
  {
    name: "weekday",
    min: 0,
    max: 7,
    aliases: WEEKDAY_ALIASES,
    normalize: (value) => value === 7 ? 0 : value,
  },
]

export function parseCronExpression(expr: string): ParsedCronExpression {
  const parts = expr.trim().split(/\s+/).filter(Boolean)
  if (parts.length !== 5) {
    throw new Error("cron expression must contain 5 fields")
  }
  const day = parseField(parts[2] ?? "", FIELD_SPECS[2])
  const weekday = parseField(parts[4] ?? "", FIELD_SPECS[4])
  return {
    minute: parseField(parts[0] ?? "", FIELD_SPECS[0]),
    hour: parseField(parts[1] ?? "", FIELD_SPECS[1]),
    day,
    month: parseField(parts[3] ?? "", FIELD_SPECS[3]),
    weekday,
    dayWildcard: isFullField(day, FIELD_SPECS[2]),
    weekdayWildcard: isFullField(weekday, FIELD_SPECS[4]),
  }
}

export function validateCronExpression(expr: string): void {
  if (!hasPossibleCalendarDay(parseCronExpression(expr))) {
    throw new Error("Cron 在 5 年内没有运行时间")
  }
}

export function hasPossibleCalendarDay(parsed: ParsedCronExpression): boolean {
  if (parsed.dayWildcard || !parsed.weekdayWildcard) return true
  for (const month of parsed.month) {
    const maxDay = new Date(2024, month, 0).getDate()
    for (const day of parsed.day) if (day <= maxDay) return true
  }
  return false
}

export function nextCronRun(expr: string, from = new Date(), timezone?: string): Date {
  const parsed = parseCronExpression(expr)
  return nextCronRunInTimezone(parsed, timezone, from)
}

function nextCronRunInTimezone(parsed: ParsedCronExpression, timezone: string | undefined, from: Date): Date {
  const readClock = createScheduleClockReader(timezone)
  const first = readClock(from)
  const day = new Date(Date.UTC(first.year, first.month - 1, first.day))
  const end = new Date(from)
  end.setFullYear(end.getFullYear() + 5)
  const endMs = end.getTime()
  const last = readClock(end)
  const lastDay = Date.UTC(last.year, last.month - 1, last.day)
  const minutes = [...parsed.hour].flatMap(hour => [...parsed.minute].map(minute => hour * 60 + minute)).sort((a, b) => a - b)
  for (; day.getTime() <= lastDay; day.setUTCDate(day.getUTCDate() + 1)) {
    if (!parsed.month.has(day.getUTCMonth() + 1) || !matchesDayFields(parsed, day.getUTCDate(), day.getUTCDay())) continue
    const offsets = offsetsAroundDay(day, readClock)
    let earliest = Infinity
    for (const minute of minutes) for (const offset of offsets) {
      const instant = day.getTime() + minute * 60_000 - offset
      if (instant <= from.getTime() || instant > endMs || instant >= earliest) continue
      if (sameWallMinute(readClock(new Date(instant)), day, minute)) earliest = instant
    }
    if (earliest !== Infinity) return new Date(earliest)
  }
  throw new Error("cron expression has no run within 5 years")
}

export function matchesDayFields(parsed: ParsedCronExpression, day: number, weekday: number): boolean {
  const dayMatches = parsed.day.has(day)
  const weekdayMatches = parsed.weekday.has(weekday)
  if (!parsed.dayWildcard && !parsed.weekdayWildcard) return dayMatches || weekdayMatches
  return dayMatches && weekdayMatches
}

function parseField(field: string, spec: FieldSpec): ReadonlySet<number> {
  const values = new Set<number>()
  for (const segment of field.split(",")) {
    const trimmed = segment.trim()
    if (!trimmed) throw new Error(`${spec.name} field contains an empty segment`)
    addSegment(values, trimmed.toLowerCase(), spec)
  }
  if (values.size === 0) throw new Error(`${spec.name} field is empty`)
  return values
}

function isFullField(values: ReadonlySet<number>, spec: FieldSpec): boolean {
  for (let value = spec.min; value <= spec.max; value += 1) {
    if (!values.has(spec.normalize?.(value) ?? value)) return false
  }
  return true
}

function addSegment(values: Set<number>, segment: string, spec: FieldSpec): void {
  const [rangePart, stepPart, extraStep] = segment.split("/")
  if (extraStep !== undefined || (segment.includes("/") && (rangePart === undefined || stepPart === undefined || !/^\d+$/.test(stepPart)))) {
    throw new Error(`${spec.name} field has an invalid step`)
  }
  const step = stepPart === undefined ? 1 : Number(stepPart)
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`${spec.name} step must be a positive integer`)
  }

  const range = parseRange(rangePart ?? "", spec)
  for (let value = range.start; value <= range.end; value += step) {
    values.add(spec.normalize?.(value) ?? value)
  }
}

function parseRange(value: string, spec: FieldSpec): { readonly start: number; readonly end: number } {
  if (value === "*") return { start: spec.min, end: spec.max }
  const [startRaw, endRaw, extraEnd] = value.split("-")
  if (extraEnd !== undefined || (value.includes("-") && (!startRaw || !endRaw))) {
    throw new Error(`${spec.name} range is invalid`)
  }
  const start = parseValue(startRaw ?? "", spec)
  const end = endRaw === undefined ? start : parseValue(endRaw, spec)
  if (start > end) throw new Error(`${spec.name} range start cannot exceed end`)
  return { start, end }
}

function parseValue(value: string, spec: FieldSpec): number {
  const aliased = spec.aliases?.[value]
  if (aliased === undefined && !/^\d+$/.test(value)) {
    throw new Error(`${spec.name} value ${value} must be an integer`)
  }
  const number = aliased ?? Number(value)
  if (!Number.isInteger(number) || number < spec.min || number > spec.max) {
    throw new Error(`${spec.name} value ${value} is out of range`)
  }
  return number
}
