import type {
  AgentMessage,
} from "../agent-runtime"
import type {
  HeartbeatEntryV1,
  ScheduledJobEntryV1,
  ScheduledJobSessionModeV1,
  ScheduledJobStatusV1,
} from "../../runtime/data-repo"

export const SCHEDULER_SERVICE_ID = "core.scheduler"
export const HEARTBEAT_SERVICE_ID = "core.heartbeat"

export type ScheduledJobKind = ScheduledJobEntryV1["kind"]
export type ScheduledJobSessionMode = ScheduledJobSessionModeV1
export type ScheduledJobStatus = ScheduledJobStatusV1
export type ScheduledJobRecord = ScheduledJobEntryV1
export type HeartbeatRecord = HeartbeatEntryV1

export interface ScheduledJobCreateInput {
  readonly projectId: string
  readonly platform: "feishu"
  readonly connectorId: string
  readonly sessionKey: string
  readonly channelKey?: string
  readonly channelName?: string
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly replyCtx?: Record<string, unknown>
  readonly kind: ScheduledJobKind
  readonly cronExpr: string
  readonly prompt?: string
  readonly exec?: string
  readonly workDir?: string
  readonly description?: string
  readonly enabled?: boolean
  readonly silent?: boolean
  readonly mute?: boolean
  readonly sessionMode?: ScheduledJobSessionMode | "reuse" | "new-per-run"
  readonly modeOverride?: string
  readonly timeoutMins?: number
  readonly createdBy?: string
}

export interface ScheduledJobUpdateInput {
  readonly cronExpr?: string
  readonly prompt?: string
  readonly exec?: string
  readonly workDir?: string
  readonly description?: string
  readonly enabled?: boolean
  readonly silent?: boolean
  readonly mute?: boolean
  readonly sessionMode?: ScheduledJobSessionMode | "reuse" | "new-per-run"
  readonly modeOverride?: string
  readonly timeoutMins?: number
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly replyCtx?: Record<string, unknown>
}

export interface ScheduledJobRunResult {
  readonly status: ScheduledJobStatus
  readonly error?: string
}

export interface HeartbeatCreateInput {
  readonly projectId: string
  readonly platform: "feishu"
  readonly connectorId: string
  readonly sessionKey: string
  readonly channelKey?: string
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly replyCtx?: Record<string, unknown>
  readonly enabled?: boolean
  readonly paused?: boolean
  readonly intervalMins: number
  readonly prompt?: string
  readonly silent?: boolean
  readonly mute?: boolean
  readonly timeoutMins?: number
}

export interface HeartbeatUpdateInput {
  readonly connectorId?: string
  readonly sessionKey?: string
  readonly channelKey?: string
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly replyCtx?: Record<string, unknown>
  readonly enabled?: boolean
  readonly paused?: boolean
  readonly intervalMins?: number
  readonly prompt?: string
  readonly silent?: boolean
  readonly mute?: boolean
  readonly timeoutMins?: number
}

export interface FeishuAutomationCommandContext {
  readonly projectId: string
  readonly connectorId: string
  readonly message: AgentMessage
  readonly isAdmin: boolean
  reply(content: string): Promise<void> | void
}
