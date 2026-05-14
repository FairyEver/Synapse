import { nextCronRun } from "./cron-expression"
import type { TaskTrigger } from "./types"

export function computeNextRunAt(input: {
  readonly trigger: TaskTrigger
  readonly from: Date
  readonly createdAt: string
}): Date {
  if (input.trigger.type === "builtin.cron") {
    return nextCronRun(input.trigger.config.expr, input.from, input.trigger.config.timezone)
  }
  const everyMs = input.trigger.config.everyMinutes * 60_000
  if (input.trigger.config.anchor === "last_completed_at") {
    return new Date(input.from.getTime() + everyMs)
  }
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
  const nextRunAtTime = nextRunAt.getTime()
  if (!Number.isFinite(nextRunAtTime)) return { action: "schedule_next" }
  if (nextRunAtTime > input.now.getTime()) return { action: "schedule_next" }
  return input.missedRunPolicy === "run_once"
    ? { action: "run_missed_once" }
    : { action: "schedule_next" }
}
