import type {
  ActionRunResult,
  ActionStoredConfigValidation,
} from "../../action-packages/types"

export type AutomationTriggerRef = {
  type: string
  config: Record<string, unknown>
}

export type AutomationExecutorRef = {
  type: string
  config: Record<string, unknown>
}

export type AutomationScope =
  | { type: "global" }
  | { type: "project"; projectId: string }

export type AutomationRunStatus =
  | "success"
  | "failed"
  | "timeout"
  | "cancelled"
  | "skipped"

export type AutomationActiveRunStatus = "running" | AutomationRunStatus
export type AutomationRunTrigger = "trigger" | "manual" | "missed_run"
export type AutomationValidation = ActionStoredConfigValidation

export type AutomationPolicy = {
  missedRunPolicy: "skip" | "run_once"
  overlapPolicy: "skip"
}

export type AutomationItem = {
  id: string
  schemaVersion: 1
  name: string
  description?: string
  enabled: boolean
  scope: AutomationScope
  cwd?: string
  trigger: AutomationTriggerRef
  executor: AutomationExecutorRef
  policy: AutomationPolicy
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: AutomationRunStatus
  activeRun?: { status: "running"; id?: string }
  validation?: AutomationValidation
  runCount: number
  configVersion: number
}

export type AutomationCreateInput = {
  name: string
  description?: string
  enabled?: boolean
  scope: AutomationScope
  cwd?: string
  trigger: AutomationTriggerRef
  executor: AutomationExecutorRef
  policy?: Partial<AutomationPolicy>
}

export type AutomationUpdateInput = {
  name?: string
  description?: string
  enabled?: boolean
  scope?: AutomationScope
  cwd?: string
  trigger?: AutomationTriggerRef
  executor?: AutomationExecutorRef
  policy?: Partial<AutomationPolicy>
}

export type AutomationRun = {
  id: string
  schemaVersion: 1
  automationId: string
  startedAt: string
  finishedAt?: string
  status: AutomationActiveRunStatus
  triggeredBy: AutomationRunTrigger
  triggerType: string
  executorType: string
  result?: ActionRunResult
  error?: string
}

export type AutomationChangedEvent = {
  itemId?: string
  runId?: string
  reason:
    | "created"
    | "updated"
    | "deleted"
    | "enabled"
    | "disabled"
    | "scheduled"
    | "run-started"
    | "run-finished"
    | "run-skipped"
    | "run-stopped"
}
