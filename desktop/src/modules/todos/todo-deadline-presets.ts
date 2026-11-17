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

export function buildTodoDeadlinePresets(now: Date): TodoDeadlinePreset[] {
  const base = startOfMinute(now)
  const todayNoon = atTime(base, 12)
  const today17 = atTime(base, 17)
  const tomorrowNoon = atTime(addDays(base, 1), 12)
  const inOneDay = addDays(base, 1)
  const inTwoDays = addDays(base, 2)

  return [
    { key: "in-1-hour", label: "1 小时后", date: addHours(base, 1), disabled: false },
    { key: "today-noon", label: "今天中午", date: todayNoon, disabled: todayNoon.getTime() <= now.getTime() },
    { key: "today-17", label: "今天 17:00", date: today17, disabled: today17.getTime() <= now.getTime() },
    { key: "tomorrow-noon", label: "明天中午", date: tomorrowNoon, disabled: false },
    { key: "in-1-day", label: "1 天后", date: inOneDay, disabled: false },
    { key: "in-2-days", label: "2 天后", date: inTwoDays, disabled: false },
  ].map(({ date, ...preset }) => ({
    ...preset,
    display: toDisplay(date),
    localValue: toLocalValue(date),
  }))
}

export function getTodoCustomDueDefault(now: Date): { date: Date; time: string } {
  const nextHour = set(addHours(startOfMinute(now), 1), { minutes: 0, seconds: 0, milliseconds: 0 })
  return { date: nextHour, time: format(nextHour, "HH:mm") }
}
