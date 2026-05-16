import type { ActionRunResult } from "../../../action-packages/types"

export const TASK_SCHEDULER_SERVICE_ID = "core.task-scheduler"

export type TaskTrigger =
  | {
      readonly type: "builtin.cron"
      readonly config: {
        readonly expr: string
        readonly timezone?: string
      }
    }
  | {
      readonly type: "builtin.interval"
      readonly config: {
        readonly everyMinutes: number
        readonly anchor?: "created_at" | "last_completed_at"
      }
    }

export type TaskScope =
  | { readonly type: "global" }
  | { readonly type: "project"; readonly projectId: string }

export type TaskActionRef = {
  readonly type: string
  readonly config: Record<string, unknown>
}

export type ScheduledTaskStatus = "success" | "failed" | "timeout" | "cancelled" | "skipped"
export type ScheduledTaskRunStatus = "running" | ScheduledTaskStatus
export type ScheduledTaskRunTrigger = "schedule" | "manual" | "missed_run"
export type ScheduledTaskActiveRun = { readonly status: "running" }

export interface ScheduledTaskEntryV2 extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 2
  readonly name: string
  readonly description?: string
  readonly scope: TaskScope
  readonly cwd?: string
  readonly trigger: TaskTrigger
  readonly action: TaskActionRef
  readonly enabled: boolean
  readonly activeDays: readonly number[]
  readonly missedRunPolicy: "skip" | "run_once"
  readonly overlapPolicy: "skip"
  readonly createdAt: string
  readonly updatedAt: string
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: ScheduledTaskStatus
  readonly activeRun?: ScheduledTaskActiveRun
  readonly runCount: number
  readonly configVersion: number
}

export type ScheduledTaskEntry = ScheduledTaskEntryV2

export interface ScheduledTaskCreateInput {
  readonly name: string
  readonly description?: string
  readonly scope: TaskScope
  readonly cwd?: string
  readonly trigger: TaskTrigger
  readonly action: TaskActionRef
  readonly enabled?: boolean
  readonly activeDays?: readonly number[]
  readonly missedRunPolicy?: "skip" | "run_once"
}

export interface ScheduledTaskUpdateInput {
  readonly name?: string
  readonly description?: string
  readonly scope?: TaskScope
  readonly cwd?: string
  readonly trigger?: TaskTrigger
  readonly action?: TaskActionRef
  readonly enabled?: boolean
  readonly activeDays?: readonly number[]
  readonly missedRunPolicy?: "skip" | "run_once"
}

export interface ScheduledTaskRunEntryV2 extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 2
  readonly taskId: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly status: ScheduledTaskRunStatus
  readonly triggeredBy: ScheduledTaskRunTrigger
  readonly result?: ActionRunResult
  readonly error?: string
}

export type ScheduledTaskRunEntry = ScheduledTaskRunEntryV2

export interface ScheduledTaskRunFinishInput {
  readonly status: Exclude<ScheduledTaskRunStatus, "running">
  readonly result?: ActionRunResult
  readonly error?: string
}
