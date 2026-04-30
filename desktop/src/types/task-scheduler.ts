export type ScheduledTaskTrigger =
  | { type: "cron"; expr: string; timezone?: string }
  | { type: "interval"; everyMinutes: number; anchor?: "created_at" | "last_completed_at" }

export type ScheduledTaskScope =
  | { type: "global" }
  | { type: "project"; projectId: string }

export type ScheduledTaskAction = {
  type: "shell_command"
  mode: "command" | "script"
  shell?: "posix" | "cmd" | "powershell"
  content: string
  env?: Record<string, string>
  timeoutMins?: number | null
}

export type ScheduledTaskStatus = "success" | "failed" | "timeout" | "cancelled" | "skipped"
export type ScheduledTaskRunStatus = "running" | ScheduledTaskStatus
export type ScheduledTaskRunTrigger = "schedule" | "manual" | "missed_run"

export type ScheduledTask = {
  id: string
  schemaVersion: 1
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskAction
  enabled: boolean
  missedRunPolicy: "skip" | "run_once"
  overlapPolicy: "skip"
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: ScheduledTaskStatus
  runCount: number
}

export type ScheduledTaskCreateInput = {
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskAction
  enabled?: boolean
  missedRunPolicy?: "skip" | "run_once"
}

export type ScheduledTaskUpdateInput = {
  name?: string
  description?: string
  scope?: ScheduledTaskScope
  cwd?: string
  trigger?: ScheduledTaskTrigger
  action?: ScheduledTaskAction
  enabled?: boolean
  missedRunPolicy?: "skip" | "run_once"
}

export type ScheduledTaskRun = {
  id: string
  schemaVersion: 1
  taskId: string
  startedAt: string
  finishedAt?: string
  status: ScheduledTaskRunStatus
  exitCode?: number | null
  stdout?: string
  stderr?: string
  error?: string
  triggeredBy: ScheduledTaskRunTrigger
}
