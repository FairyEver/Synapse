export interface ParsedCronExpression {
  readonly minute: ReadonlySet<number>
  readonly hour: ReadonlySet<number>
  readonly day: ReadonlySet<number>
  readonly month: ReadonlySet<number>
  readonly weekday: ReadonlySet<number>
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
  return {
    minute: parseField(parts[0] ?? "", FIELD_SPECS[0]),
    hour: parseField(parts[1] ?? "", FIELD_SPECS[1]),
    day: parseField(parts[2] ?? "", FIELD_SPECS[2]),
    month: parseField(parts[3] ?? "", FIELD_SPECS[3]),
    weekday: parseField(parts[4] ?? "", FIELD_SPECS[4]),
  }
}

export function validateCronExpression(expr: string): void {
  parseCronExpression(expr)
}

export function nextCronRun(expr: string, from = new Date()): Date {
  const parsed = parseCronExpression(expr)
  const candidate = new Date(from)
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)
  const end = new Date(from)
  end.setFullYear(end.getFullYear() + 5)

  while (candidate <= end) {
    if (matchesCron(parsed, candidate)) return new Date(candidate)
    candidate.setMinutes(candidate.getMinutes() + 1)
  }
  throw new Error("cron expression has no run within 5 years")
}

function matchesCron(parsed: ParsedCronExpression, date: Date): boolean {
  return parsed.minute.has(date.getMinutes())
    && parsed.hour.has(date.getHours())
    && parsed.day.has(date.getDate())
    && parsed.month.has(date.getMonth() + 1)
    && parsed.weekday.has(date.getDay())
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

function addSegment(values: Set<number>, segment: string, spec: FieldSpec): void {
  const [rangePart, stepPart] = segment.split("/")
  if (segment.includes("/") && (rangePart === undefined || stepPart === undefined || stepPart === "")) {
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
  const [startRaw, endRaw] = value.split("-")
  if (value.includes("-") && (!startRaw || !endRaw)) {
    throw new Error(`${spec.name} range is invalid`)
  }
  const start = parseValue(startRaw ?? "", spec)
  const end = endRaw === undefined ? start : parseValue(endRaw, spec)
  if (start > end) throw new Error(`${spec.name} range start cannot exceed end`)
  return { start, end }
}

function parseValue(value: string, spec: FieldSpec): number {
  const aliased = spec.aliases?.[value]
  const number = aliased ?? Number(value)
  if (!Number.isInteger(number) || number < spec.min || number > spec.max) {
    throw new Error(`${spec.name} value ${value} is out of range`)
  }
  return number
}
