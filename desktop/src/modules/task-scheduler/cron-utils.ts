export type CronTemplateKind =
  | "every_minutes"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "weekdays"

export type CronEditorTab = "common" | "advanced"

export type CronTemplateDraft = {
  kind: CronTemplateKind
  everyMinutes: number
  minute: number
  hour: number
  dayOfMonth: number
  weekday: number
}

export type ParsedCronExpression = {
  readonly minute: ReadonlySet<number>
  readonly hour: ReadonlySet<number>
  readonly day: ReadonlySet<number>
  readonly month: ReadonlySet<number>
  readonly weekday: ReadonlySet<number>
  readonly dayWildcard: boolean
  readonly weekdayWildcard: boolean
}

export type CronValidationResult =
  | { ok: true }
  | { ok: false; message: string }

type CronFieldName = "minute" | "hour" | "day" | "month" | "weekday"

type FieldSpec = {
  readonly name: CronFieldName
  readonly label: string
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
  { name: "minute", label: "分钟", min: 0, max: 59 },
  { name: "hour", label: "小时", min: 0, max: 23 },
  { name: "day", label: "日期", min: 1, max: 31 },
  { name: "month", label: "月份", min: 1, max: 12, aliases: MONTH_ALIASES },
  {
    name: "weekday",
    label: "星期",
    min: 0,
    max: 7,
    aliases: WEEKDAY_ALIASES,
    normalize: (value) => value === 7 ? 0 : value,
  },
]

const DEFAULT_CRON_TEMPLATE_DRAFT: CronTemplateDraft = {
  kind: "daily",
  everyMinutes: 15,
  minute: 0,
  hour: 9,
  dayOfMonth: 1,
  weekday: 1,
}

function createDefaultCronTemplateDraft(): CronTemplateDraft {
  return { ...DEFAULT_CRON_TEMPLATE_DRAFT }
}

function buildCronExpression(draft: CronTemplateDraft): string {
  switch (draft.kind) {
    case "every_minutes":
      return `*/${draft.everyMinutes} * * * *`
    case "hourly":
      return `${draft.minute} * * * *`
    case "daily":
      return `${draft.minute} ${draft.hour} * * *`
    case "weekly":
      return `${draft.minute} ${draft.hour} * * ${draft.weekday}`
    case "monthly":
      return `${draft.minute} ${draft.hour} ${draft.dayOfMonth} * *`
    case "weekdays":
      return `${draft.minute} ${draft.hour} * * 1-5`
  }
}

function inferCronTemplate(expr: string): CronTemplateDraft | null {
  const parts = expr.trim().split(/\s+/).filter(Boolean)
  if (parts.length !== 5) return null
  const [minute, hour, day, month, weekday] = parts
  const base = createDefaultCronTemplateDraft()

  const everyMinutes = minute?.match(/^\*\/([1-9]\d*)$/)
  if (everyMinutes && hour === "*" && day === "*" && month === "*" && weekday === "*") {
    return { ...base, kind: "every_minutes", everyMinutes: Number(everyMinutes[1]) }
  }

  if (isPlainNumber(minute) && hour === "*" && day === "*" && month === "*" && weekday === "*") {
    return { ...base, kind: "hourly", minute: Number(minute) }
  }

  if (isPlainNumber(minute) && isPlainNumber(hour) && day === "*" && month === "*" && weekday === "*") {
    return { ...base, kind: "daily", minute: Number(minute), hour: Number(hour) }
  }

  if (isPlainNumber(minute) && isPlainNumber(hour) && day === "*" && month === "*" && isPlainNumber(weekday)) {
    return { ...base, kind: "weekly", minute: Number(minute), hour: Number(hour), weekday: Number(weekday) }
  }

  if (isPlainNumber(minute) && isPlainNumber(hour) && isPlainNumber(day) && month === "*" && weekday === "*") {
    return { ...base, kind: "monthly", minute: Number(minute), hour: Number(hour), dayOfMonth: Number(day) }
  }

  if (isPlainNumber(minute) && isPlainNumber(hour) && day === "*" && month === "*" && weekday === "1-5") {
    return { ...base, kind: "weekdays", minute: Number(minute), hour: Number(hour) }
  }

  return null
}

function parseCronExpression(expr: string): ParsedCronExpression {
  const parts = expr.trim().split(/\s+/).filter(Boolean)
  if (parts.length !== 5) {
    throw new Error("Cron 必须包含 5 段")
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

function validateCronExpression(expr: string): CronValidationResult {
  try {
    parseCronExpression(expr)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Cron 不合法",
    }
  }
}

function listNextCronRuns(expr: string, from = new Date(), count = 5): Date[] {
  const runs: Date[] = []
  let cursor = new Date(from)

  for (let index = 0; index < count; index += 1) {
    const next = nextCronRun(expr, cursor)
    runs.push(next)
    cursor = next
  }

  return runs
}

function getCronEditorInitialTab(expr: string): CronEditorTab {
  const validation = validateCronExpression(expr)
  if (!validation.ok) return "advanced"
  return inferCronTemplate(expr) ? "common" : "advanced"
}

function nextCronRun(expr: string, from = new Date()): Date {
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

  throw new Error("Cron 在 5 年内没有运行时间")
}

function matchesCron(parsed: ParsedCronExpression, date: Date): boolean {
  return parsed.minute.has(date.getMinutes())
    && parsed.hour.has(date.getHours())
    && parsed.month.has(date.getMonth() + 1)
    && matchesDayFields(parsed, date.getDate(), date.getDay())
}

function matchesDayFields(parsed: ParsedCronExpression, day: number, weekday: number): boolean {
  const dayMatches = parsed.day.has(day)
  const weekdayMatches = parsed.weekday.has(weekday)
  if (!parsed.dayWildcard && !parsed.weekdayWildcard) return dayMatches || weekdayMatches
  return dayMatches && weekdayMatches
}

function parseField(field: string, spec: FieldSpec): ReadonlySet<number> {
  const values = new Set<number>()

  for (const segment of field.split(",")) {
    const trimmed = segment.trim()
    if (!trimmed) throw new Error(`${spec.label}包含空段`)
    addSegment(values, trimmed.toLowerCase(), spec)
  }

  if (values.size === 0) throw new Error(`${spec.label}没有有效值`)
  return new Set([...values].sort((a, b) => a - b))
}

function isFullField(values: ReadonlySet<number>, spec: FieldSpec): boolean {
  for (let value = spec.min; value <= spec.max; value += 1) {
    if (!values.has(spec.normalize?.(value) ?? value)) return false
  }
  return true
}

function addSegment(values: Set<number>, segment: string, spec: FieldSpec): void {
  const [rangePart, stepPart] = segment.split("/")
  if (segment.includes("/") && (rangePart === undefined || stepPart === undefined || stepPart === "")) {
    throw new Error(`${spec.label}的步长格式不正确`)
  }

  const step = stepPart === undefined ? 1 : Number(stepPart)
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`${spec.label}的步长必须是正整数`)
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
    throw new Error(`${spec.label}的范围格式不正确`)
  }

  const start = parseValue(startRaw ?? "", spec)
  const end = endRaw === undefined ? start : parseValue(endRaw, spec)
  if (start > end) throw new Error(`${spec.label}的范围起始值不能大于结束值`)
  return { start, end }
}

function parseValue(value: string, spec: FieldSpec): number {
  const aliased = spec.aliases?.[value]
  const number = aliased ?? Number(value)
  if (!Number.isInteger(number) || number < spec.min || number > spec.max) {
    throw new Error(`${spec.label}的值 ${value} 超出范围（${spec.min}-${spec.max}）`)
  }
  return number
}

function isPlainNumber(value: string | undefined): value is string {
  return value !== undefined && /^\d+$/.test(value)
}

export {
  buildCronExpression,
  createDefaultCronTemplateDraft,
  getCronEditorInitialTab,
  inferCronTemplate,
  listNextCronRuns,
  parseCronExpression,
  validateCronExpression,
}
