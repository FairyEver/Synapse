import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"
import type { ActionConfig } from "../../../action-packages/types"

type TaskFormTriggerType = "cron" | "interval"

type TaskFormState = {
  name: string
  description: string
  cwd: string
  enabled: boolean
  triggerType: TaskFormTriggerType
  cronExpr: string
  everyMinutes: string
  intervalAnchor: "created_at" | "last_completed_at"
  actionType: string
  actionConfig: ActionConfig
  missedRunPolicy: "skip" | "run_once"
}

type TaskFormMode = "create" | "edit"

type TaskFormPayload = ScheduledTaskCreateInput | ScheduledTaskUpdateInput

type TaskFormDialogState =
  | { mode: "create"; task?: undefined }
  | { mode: "edit"; task: ScheduledTask }

export type {
  TaskFormDialogState,
  TaskFormMode,
  TaskFormPayload,
  TaskFormState,
  TaskFormTriggerType,
}
