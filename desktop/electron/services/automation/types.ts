import type {
  ActionRunResult,
  ActionStoredConfigValidation,
} from "../../../action-packages/types"

export type {
  AutomationTriggerEvent,
} from "../../../automation-trigger-packages/types.shared"

export const AUTOMATION_SERVICE_ID = "core.automation"

export type AutomationTriggerRef = {
  readonly type: string
  readonly config: Record<string, unknown>
}

export type AutomationExecutorRef = {
  readonly type: string
  readonly config: Record<string, unknown>
}

export type AutomationScope =
  | { readonly type: "global" }
  | { readonly type: "project"; readonly projectId: string }

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
  readonly missedRunPolicy: "skip" | "run_once"
  readonly overlapPolicy: "skip"
}

export interface AutomationItem extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 1
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
  readonly scope: AutomationScope
  readonly cwd?: string
  readonly trigger: AutomationTriggerRef
  readonly executor: AutomationExecutorRef
  readonly policy: AutomationPolicy
  readonly createdAt: string
  readonly updatedAt: string
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: AutomationRunStatus
  readonly activeRun?: { readonly status: "running"; readonly id?: string }
  readonly validation?: AutomationValidation
  readonly runCount: number
  readonly configVersion: number
}

export interface AutomationCreateInput {
  readonly name: string
  readonly description?: string
  readonly enabled?: boolean
  readonly scope: AutomationScope
  readonly cwd?: string
  readonly trigger: AutomationTriggerRef
  readonly executor: AutomationExecutorRef
  readonly policy?: Partial<AutomationPolicy>
}

export interface AutomationUpdateInput {
  readonly name?: string
  readonly description?: string
  readonly enabled?: boolean
  readonly scope?: AutomationScope
  readonly cwd?: string
  readonly trigger?: AutomationTriggerRef
  readonly executor?: AutomationExecutorRef
  readonly policy?: Partial<AutomationPolicy>
}

export interface AutomationRun extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 1
  readonly automationId: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly status: AutomationActiveRunStatus
  readonly triggeredBy: AutomationRunTrigger
  readonly triggerType: string
  readonly executorType: string
  readonly result?: ActionRunResult
  readonly error?: string
}

export interface AutomationRunFinishInput {
  readonly status: AutomationRunStatus
  readonly result?: ActionRunResult
  readonly error?: string
}
