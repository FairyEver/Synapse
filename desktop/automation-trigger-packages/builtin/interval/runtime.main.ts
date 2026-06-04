import type {
  AutomationScheduleGuardInput,
  AutomationScheduleInput,
  AutomationTriggerRuntime,
} from "../../types.shared"
import type { IntervalTriggerConfig } from "./schema"

export const intervalTriggerRuntime: AutomationTriggerRuntime<IntervalTriggerConfig> = {
  computeNextRunAt(input: AutomationScheduleInput<IntervalTriggerConfig>): Date {
    const everyMs = input.config.everyMinutes * 60_000
    if (input.config.anchor === "last_completed_at") {
      return new Date(input.from.getTime() + everyMs)
    }
    const anchor = new Date(input.createdAt).getTime()
    const from = input.from.getTime()
    const elapsed = Math.max(0, from - anchor)
    const steps = Math.floor(elapsed / everyMs) + 1
    return new Date(anchor + steps * everyMs)
  },
  shouldRunNow(input: AutomationScheduleGuardInput<IntervalTriggerConfig>): boolean {
    if (input.config.activeDays.length >= 7) return true
    return input.config.activeDays.includes(input.now.getDay())
  },
  getReschedulePolicy(config: IntervalTriggerConfig) {
    return config.anchor === "last_completed_at"
      ? { mode: "after_completion" as const }
      : { mode: "before_run" as const }
  },
}
