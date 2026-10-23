import { z } from "zod"

export const automationTimeRangeSchema = z.object({
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "开始时间格式应为 HH:mm"),
  end: z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/, "结束时间格式应为 HH:mm，可使用 24:00"),
}).refine((range) => range.start < range.end, {
  path: ["end"],
  message: "结束时间必须晚于开始时间",
}).describe("每日触发时间范围，包含开始、不包含结束；省略表示全天。")

export type AutomationTimeRange = z.infer<typeof automationTimeRangeSchema>
export type AutomationScheduleConstraints = {
  readonly activeDays: readonly number[]
  readonly timeRange?: AutomationTimeRange
}

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

export function isAutomationScheduleAllowed(
  date: Date,
  config: AutomationScheduleConstraints,
  timezone?: string,
): boolean {
  const clock = createScheduleClockReader(timezone)(date)
  return config.activeDays.includes(clock.weekday) && (!config.timeRange || (
    clock.minute >= timeOfDayMinutes(config.timeRange.start) &&
    clock.minute < timeOfDayMinutes(config.timeRange.end)
  ))
}
