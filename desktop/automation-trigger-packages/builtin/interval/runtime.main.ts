import { computeNextRunAt as computeAutomationNextRunAt } from "../../../electron/services/automation/schedule-calculator"
import type {
  AutomationScheduleInput,
  AutomationTriggerRuntime,
} from "../../types.shared"
import type { IntervalTriggerConfig } from "./schema"

export const intervalTriggerRuntime: AutomationTriggerRuntime<IntervalTriggerConfig> = {
  computeNextRunAt(input: AutomationScheduleInput<IntervalTriggerConfig>): Date | null {
    return computeAutomationNextRunAt({
      trigger: { type: "builtin.interval", config: input.config },
      conditions: input.conditions,
      from: input.from,
      createdAt: input.createdAt,
    })
  },
  getReschedulePolicy(config: IntervalTriggerConfig) {
    return config.anchor === "last_completed_at"
      ? { mode: "after_completion" as const }
      : { mode: "before_run" as const }
  },
}
