import type { ControlledProcessResult } from "../../runtime/process"

export const TASK_SCHEDULER_SERVICE_ID = "core.task-scheduler"

export type TaskTrigger =
  | { readonly type: "cron"; readonly expr: string; readonly timezone?: string }
  | { readonly type: "interval"; readonly everyMinutes: number; readonly anchor?: "created_at" | "last_completed_at" }

export type TaskScope =
  | { readonly type: "global" }
  | { readonly type: "project"; readonly projectId: string }

export type ShellTaskAction = {
  readonly type: "shell_command"
  readonly mode: "command" | "script"
  readonly content: string
  readonly env?: Record<string, string>
  readonly timeoutMins?: number | null
}

export type TaskAction = ShellTaskAction

export type ScheduledTaskStatus = "success" | "failed" | "timeout" | "cancelled" | "skipped"
export type ScheduledTaskRunStatus = "running" | ScheduledTaskStatus
export type ScheduledTaskRunTrigger = "schedule" | "manual" | "missed_run"

export interface ScheduledTaskEntryV1 extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 1
  readonly name: string
  readonly description?: string
  readonly scope: TaskScope
  readonly cwd?: string
  readonly trigger: TaskTrigger
  readonly action: TaskAction
  readonly enabled: boolean
  readonly missedRunPolicy: "skip" | "run_once"
  readonly overlapPolicy: "skip"
  readonly createdAt: string
  readonly updatedAt: string
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: ScheduledTaskStatus
  readonly runCount: number
}

export interface ScheduledTaskRunEntryV1 extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 1
  readonly taskId: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly status: ScheduledTaskRunStatus
  readonly exitCode?: number | null
  readonly stdout?: string
  readonly stderr?: string
  readonly error?: string
  readonly triggeredBy: ScheduledTaskRunTrigger
}

export interface TaskActionExecutionInput {
  readonly task: ScheduledTaskEntryV1
  readonly runId: string
  readonly cwd: string
  readonly abortSignal: AbortSignal
}

export interface TaskActionExecutionResult {
  readonly status: Exclude<ScheduledTaskRunStatus, "running">
  readonly process?: ControlledProcessResult
  readonly error?: string
}

export interface TaskActionExecutor {
  readonly type: TaskAction["type"]
  execute(input: TaskActionExecutionInput): Promise<TaskActionExecutionResult>
}
