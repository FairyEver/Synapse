import { addDays, addHours, format, set, startOfMinute } from "date-fns"

export type TodoDeadlinePresetKey =
  | "in-1-hour"
  | "today-noon"
  | "today-17"
  | "tomorrow-noon"
  | "in-1-day"
  | "in-2-days"

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
  const todayNoon = atTime(base, 12)
  const today17 = atTime(base, 17)
  const tomorrowNoon = atTime(addDays(base, 1), 12)
  const inOneDay = addDays(base, 1)
  const inTwoDays = addDays(base, 2)

  return [
    preset("in-1-hour", "1 小时后", addHours(base, 1)),
    preset("today-noon", "今天中午", todayNoon, todayNoon.getTime() <= now.getTime()),
    preset("today-17", "今天 17:00", today17, today17.getTime() <= now.getTime()),
    preset("tomorrow-noon", "明天中午", tomorrowNoon),
    preset("in-1-day", "1 天后", inOneDay),
    preset("in-2-days", "2 天后", inTwoDays),
  ]
}

export function getTodoCustomDueDefault(now: Date): { date: Date; time: string } {
  const nextHour = set(addHours(startOfMinute(now), 1), { minutes: 0, seconds: 0, milliseconds: 0 })
  return { date: nextHour, time: format(nextHour, "HH:mm") }
}
