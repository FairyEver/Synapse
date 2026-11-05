import { z } from "zod"

const automationWeekdaySchema = z.number().int().min(0).max(6)

export const automationTimeRangeSchema = z.object({
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "开始时间格式应为 HH:mm"),
  end: z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/, "结束时间格式应为 HH:mm，可使用 24:00"),
}).refine((range) => range.start < range.end, {
  path: ["end"],
  message: "结束时间必须晚于开始时间",
}).describe("每日触发时间范围，包含开始、不包含结束；省略表示全天。")

export type AutomationTimeRange = z.infer<typeof automationTimeRangeSchema>

const automationWeekdaysConditionSchema = z.object({
  type: z.literal("weekdays"),
  days: z.array(automationWeekdaySchema).min(1, "至少选择一个星期").max(7)
    .transform((days) => [...new Set(days)].sort((left, right) => left - right)),
}).strict()

const automationDailyTimeRangeConditionSchema = z.object({
  type: z.literal("daily-time-range"),
  start: automationTimeRangeSchema.shape.start,
  end: automationTimeRangeSchema.shape.end,
}).strict().refine((range) => range.start < range.end, {
  path: ["end"],
  message: "结束时间必须晚于开始时间",
})

export const automationConditionSchema = z.discriminatedUnion("type", [
  automationWeekdaysConditionSchema,
  automationDailyTimeRangeConditionSchema,
])

export const automationConditionsSchema = z.object({
  operator: z.enum(["and", "or"]),
  items: z.array(automationConditionSchema).min(1, "至少添加一个条件")
    .superRefine((items, context) => {
      const seen = new Set<string>()
      for (const [index, item] of items.entries()) {
        if (seen.has(item.type)) {
          context.addIssue({
            code: "custom",
            path: [index, "type"],
            message: "同一类条件只能添加一次",
          })
        }
        seen.add(item.type)
      }
    }),
}).strict()

export type AutomationCondition = z.infer<typeof automationConditionSchema>
export type AutomationConditions = z.infer<typeof automationConditionsSchema>

export type ScheduleClock = {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly weekday: number
  readonly minute: number
}

export function timeOfDayMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number)
  return hour! * 60 + minute!
}

export function createScheduleClockReader(timezone?: string): (date: Date) => ScheduleClock {
  if (!timezone) return (date) => ({
    year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
    weekday: date.getDay(), minute: date.getHours() * 60 + date.getMinutes(),
  })
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  })
  return (date) => {
    const values: Record<string, number> = {}
    for (const part of formatter.formatToParts(date)) {
      if (part.type !== "literal") values[part.type] = Number(part.value)
    }
    const year = values.year!
    const month = values.month!
    const day = values.day!
    return {
      year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
      minute: values.hour! * 60 + values.minute!,
    }
  }
}

export function isAutomationConditionsSatisfied(
  date: Date,
  conditions: AutomationConditions | undefined,
  timezone?: string,
): boolean {
  if (!conditions?.items.length) return true
  if (!Number.isFinite(date.getTime())) return false
  const clock = createScheduleClockReader(timezone)(date)
  const matches = conditions.items.map((condition) => {
    if (condition.type === "weekdays") return condition.days.includes(clock.weekday)
    return clock.minute >= timeOfDayMinutes(condition.start) &&
      clock.minute < timeOfDayMinutes(condition.end)
  })
  return conditions.operator === "and" ? matches.every(Boolean) : matches.some(Boolean)
}

export function summarizeAutomationConditions(conditions: AutomationConditions | undefined): string {
  if (!conditions?.items.length) return ""
  const labels = conditions.items.map((condition) => {
    if (condition.type === "daily-time-range") return `${condition.start}–${condition.end}`
    const days = [...condition.days].sort((left, right) => left - right)
    if (days.length === 7) return "每天"
    if (days.join(",") === "1,2,3,4,5") return "周一至周五"
    if (days.join(",") === "0,6") return "周末"
    const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    return days.map((day) => names[day]).join("、")
  })
  const separator = conditions.operator === "and" ? " 并且 " : " 或者 "
  return labels.join(separator)
}
