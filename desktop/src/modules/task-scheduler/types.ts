import type {
  ScheduledTask,
  ScheduledTaskActionRef,
  ScheduledTaskScope,
  ScheduledTaskTrigger,
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
  activeDays?: number[]
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
  TaskFormState,
}
