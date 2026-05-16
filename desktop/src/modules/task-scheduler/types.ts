import type {
  ScheduledTask,
  ScheduledTaskActionRef,
  ScheduledTaskCreateInput,
  ScheduledTaskScope,
  ScheduledTaskTrigger,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"
import type { ActionConfig } from "../../../action-packages/types"

type TaskFormTriggerType = "cron" | "interval"

type TaskFormState = {
  name: string
  description: string
  cwd: string
  enabled: boolean
  activeDays: number[]
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

type TaskExportEntry = {
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskActionRef
  missedRunPolicy: "skip" | "run_once"
}

type TaskExportFile = {
  version: 1
  exportedAt: string
  tasks: TaskExportEntry[]
}

export type {
  TaskExportEntry,
  TaskExportFile,
  TaskFormDialogState,
  TaskFormMode,
  TaskFormPayload,
  TaskFormState,
  TaskFormTriggerType,
}
