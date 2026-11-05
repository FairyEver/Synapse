import { computeNextRunAt as computeAutomationNextRunAt } from "../../../electron/services/automation/schedule-calculator"
import type {
  AutomationScheduleInput,
  AutomationTriggerRuntime,
} from "../../types.shared"
import type { CronTriggerConfig } from "./schema"

export const cronTriggerRuntime: AutomationTriggerRuntime<CronTriggerConfig> = {
  computeNextRunAt(input: AutomationScheduleInput<CronTriggerConfig>): Date | null {
    return computeAutomationNextRunAt({
      trigger: { type: "builtin.cron", config: input.config },
      conditions: input.conditions,
      from: input.from,
      createdAt: input.createdAt,
    })
  },
  getReschedulePolicy: () => ({ mode: "before_run" }),
}
