import type { ActionRunResult } from "../../action-packages/types"

export type ScheduledTaskTrigger =
  | { type: "builtin.cron"; config: { expr: string; timezone?: string } }
  | { type: "builtin.interval"; config: { everyMinutes: number; anchor?: "created_at" | "last_completed_at" } }

export type ScheduledTaskScope =
  | { type: "global" }
  | { type: "project"; projectId: string }

export type ScheduledTaskActionRef = {
  type: string
  config: Record<string, unknown>
}

export type ScheduledTaskStatus = "success" | "failed" | "timeout" | "cancelled" | "skipped"
export type ScheduledTaskRunStatus = "running" | ScheduledTaskStatus
export type ScheduledTaskRunTrigger = "schedule" | "manual" | "missed_run"
export type ScheduledTaskActiveRun = { status: "running"; id?: string }

export type ScheduledTask = {
  id: string
  schemaVersion: 2
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskActionRef
  enabled: boolean
  activeDays: number[]
  missedRunPolicy: "skip" | "run_once"
  overlapPolicy: "skip"
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: ScheduledTaskStatus
  activeRun?: ScheduledTaskActiveRun
  runCount: number
}

export type ScheduledTaskCreateInput = {
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskActionRef
  enabled?: boolean
  activeDays?: number[]
  missedRunPolicy?: "skip" | "run_once"
}

export type ScheduledTaskUpdateInput = {
  name?: string
  description?: string
  scope?: ScheduledTaskScope
  cwd?: string
  trigger?: ScheduledTaskTrigger
  action?: ScheduledTaskActionRef
  enabled?: boolean
  activeDays?: number[]
  missedRunPolicy?: "skip" | "run_once"
}

export type ScheduledTaskRun = {
  id: string
  schemaVersion: 2
  taskId: string
  startedAt: string
  finishedAt?: string
  status: ScheduledTaskRunStatus
  result?: ActionRunResult
  error?: string
  triggeredBy: ScheduledTaskRunTrigger
}
