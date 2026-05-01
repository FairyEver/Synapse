import { nextCronRun } from "./cron-expression"
import type { TaskTrigger } from "./types"

export function computeNextRunAt(input: {
  readonly trigger: TaskTrigger
  readonly from: Date
  readonly createdAt: string
}): Date {
  if (input.trigger.type === "builtin.cron") {
    return nextCronRun(input.trigger.config.expr, input.from)
  }
  const everyMs = input.trigger.config.everyMinutes * 60_000
  const anchor = new Date(input.createdAt).getTime()
  const from = input.from.getTime()
  const elapsed = Math.max(0, from - anchor)
  const steps = Math.floor(elapsed / everyMs) + 1
  return new Date(anchor + steps * everyMs)
}

export function resolveStartupSchedule(input: {
  readonly enabled: boolean
  readonly nextRunAt?: string
  readonly missedRunPolicy: "skip" | "run_once"
  readonly trigger: TaskTrigger
  readonly createdAt: string
  readonly now: Date
}): { readonly action: "none" | "schedule_next" | "run_missed_once" } {
  if (!input.enabled) return { action: "none" }
  if (!input.nextRunAt) return { action: "schedule_next" }
  const nextRunAt = new Date(input.nextRunAt)
  if (nextRunAt.getTime() > input.now.getTime()) return { action: "schedule_next" }
  return input.missedRunPolicy === "run_once"
    ? { action: "run_missed_once" }
    : { action: "schedule_next" }
}
