import { computeNextRunAt as computeAutomationNextRunAt } from "../../../electron/services/automation/schedule-calculator"
import type {
  AutomationScheduleGuardInput,
  AutomationScheduleInput,
  AutomationTriggerRuntime,
} from "../../types.shared"
import type { CronTriggerConfig } from "./schema"
import { isAutomationScheduleAllowed } from "../../schedule-constraints"

export const cronTriggerRuntime: AutomationTriggerRuntime<CronTriggerConfig> = {
  computeNextRunAt(input: AutomationScheduleInput<CronTriggerConfig>): Date | null {
    return computeAutomationNextRunAt({
      trigger: { type: "builtin.cron", config: input.config },
      from: input.from,
      createdAt: input.createdAt,
    })
  },
  shouldRunNow(input: AutomationScheduleGuardInput<CronTriggerConfig>): boolean {
    return isAutomationScheduleAllowed(input.now, input.config, input.config.timezone)
  },
  getReschedulePolicy: () => ({ mode: "before_run" }),
}
