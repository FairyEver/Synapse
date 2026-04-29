import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"

type TaskFormTriggerType = "cron" | "interval"
type TaskFormScopeType = "global" | "project"

type TaskFormState = {
  name: string
  description: string
  scopeType: TaskFormScopeType
  projectId: string
  cwd: string
  enabled: boolean
  triggerType: TaskFormTriggerType
  cronExpr: string
  everyMinutes: string
  intervalAnchor: "created_at" | "last_completed_at"
  actionMode: "command" | "script"
  actionContent: string
  envText: string
  timeoutEnabled: boolean
  timeoutMins: string
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
  TaskFormScopeType,
  TaskFormState,
  TaskFormTriggerType,
}
