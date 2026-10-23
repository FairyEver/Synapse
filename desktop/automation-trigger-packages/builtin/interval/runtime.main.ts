import { computeNextRunAt as computeAutomationNextRunAt } from "../../../electron/services/automation/schedule-calculator"
import type {
  AutomationScheduleGuardInput,
  AutomationScheduleInput,
  AutomationTriggerRuntime,
} from "../../types.shared"
import type { IntervalTriggerConfig } from "./schema"
import { isAutomationScheduleAllowed } from "../../schedule-constraints"

export const intervalTriggerRuntime: AutomationTriggerRuntime<IntervalTriggerConfig> = {
  computeNextRunAt(input: AutomationScheduleInput<IntervalTriggerConfig>): Date | null {
    return computeAutomationNextRunAt({
      trigger: { type: "builtin.interval", config: input.config },
      from: input.from,
      createdAt: input.createdAt,
    })
  },
  shouldRunNow(input: AutomationScheduleGuardInput<IntervalTriggerConfig>): boolean {
    return isAutomationScheduleAllowed(input.now, input.config)
  },
  getReschedulePolicy(config: IntervalTriggerConfig) {
    return config.anchor === "last_completed_at"
      ? { mode: "after_completion" as const }
      : { mode: "before_run" as const }
  },
}
