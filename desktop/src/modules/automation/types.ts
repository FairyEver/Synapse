import type { AutomationItem } from "@/types/automation"
import type { ActionConfig } from "../../../action-packages/types"

type AutomationFormTriggerType = "cron" | "interval"

type AutomationFormState = {
  name: string
  description: string
  cwd: string
  enabled: boolean
  activeDays: number[]
  triggerType: AutomationFormTriggerType
  cronExpr: string
  cronTimezone: string
  everyMinutes: string
  intervalAnchor: "created_at" | "last_completed_at"
  executorType: string
  executorConfig: ActionConfig
  missedRunPolicy: "skip" | "run_once"
}

type AutomationFormDialogState =
  | { mode: "create"; item?: undefined }
  | { mode: "edit"; item: AutomationItem }

export type {
  AutomationFormDialogState,
  AutomationFormState,
  AutomationFormTriggerType,
}
