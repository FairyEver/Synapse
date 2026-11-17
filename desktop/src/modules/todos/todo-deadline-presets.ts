import { addDays, addHours, endOfMonth, format, set, startOfMinute } from "date-fns"

export type TodoDeadlinePresetKey =
  | "in-1-hour"
  | "today-afternoon"
  | "tomorrow-afternoon"
  | "month-midpoint"
  | "month-end"

export type TodoDeadlinePreset = {
  key: TodoDeadlinePresetKey
  label: string
  display: string
  localValue: string
  disabled: boolean
}

const toLocalValue = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm")
const toDisplay = (date: Date) => format(date, "M月d日 HH:mm")
const atTime = (date: Date, hours: number, minutes = 0) =>
  set(date, { hours, minutes, seconds: 0, milliseconds: 0 })
const preset = (
  key: TodoDeadlinePresetKey,
  label: string,
  date: Date,
  disabled = false
): TodoDeadlinePreset => ({
  key,
  label,
  display: toDisplay(date),
  localValue: toLocalValue(date),
  disabled,
})

export function buildTodoDeadlinePresets(now: Date): TodoDeadlinePreset[] {
  const base = startOfMinute(now)
  const todayAfternoon = atTime(base, 17)
  const tomorrowAfternoon = atTime(addDays(base, 1), 17)
  const monthMidpoint = atTime(set(base, { date: 15 }), 17)
  const monthEnd = atTime(endOfMonth(base), 17)

  return [
    preset("in-1-hour", "1 小时后", addHours(base, 1)),
    preset("today-afternoon", "今天下午", todayAfternoon, todayAfternoon.getTime() <= now.getTime()),
    preset("tomorrow-afternoon", "明天下午", tomorrowAfternoon),
    preset("month-midpoint", "本月 15 号", monthMidpoint, monthMidpoint.getTime() <= now.getTime()),
    preset("month-end", "本月末", monthEnd, monthEnd.getTime() <= now.getTime()),
  ]
}

export function getTodoCustomDueDefault(now: Date): { date: Date; time: string } {
  const nextHour = set(addHours(startOfMinute(now), 1), { minutes: 0, seconds: 0, milliseconds: 0 })
  return { date: nextHour, time: format(nextHour, "HH:mm") }
}
