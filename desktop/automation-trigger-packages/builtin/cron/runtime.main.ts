import { nextCronRun } from "../../../electron/services/task-scheduler/cron-expression"
import type {
  AutomationScheduleGuardInput,
  AutomationScheduleInput,
  AutomationTriggerRuntime,
} from "../../types.shared"
import type { CronTriggerConfig } from "./schema"

export const cronTriggerRuntime: AutomationTriggerRuntime<CronTriggerConfig> = {
  computeNextRunAt(input: AutomationScheduleInput<CronTriggerConfig>): Date {
    return nextCronRun(input.config.expr, input.from, input.config.timezone)
  },
  shouldRunNow(input: AutomationScheduleGuardInput<CronTriggerConfig>): boolean {
    return isActiveDay(input.now, input.config)
  },
  getReschedulePolicy: () => ({ mode: "before_run" }),
}

function isActiveDay(date: Date, config: CronTriggerConfig): boolean {
  if (config.activeDays.length >= 7) return true
  const weekday = config.timezone ? weekdayForTimezone(date, config.timezone) : date.getDay()
  return config.activeDays.includes(weekday)
}

function weekdayForTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).formatToParts(date)
  const weekdayStr = parts.find((part) => part.type === "weekday")?.value ?? ""
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekdayStr] ?? date.getDay()
}
