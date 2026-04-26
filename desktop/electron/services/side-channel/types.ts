import type { AgentEvent } from "../agent-runtime"
import type { ReplyTarget } from "../reply-target"

export const SIDE_CHANNEL_SERVICE_ID = "core.side-channel"

export interface SideChannelAttachmentInput {
  readonly path?: string
  readonly data?: string
  readonly dataBase64?: string
  readonly mimeType?: string
  readonly mime_type?: string
  readonly fileName?: string
  readonly file_name?: string
}

export interface SideChannelSendRequest {
  readonly project?: string
  readonly projectId?: string
  readonly sessionKey?: string
  readonly session_key?: string
  readonly message?: string
  readonly images?: readonly SideChannelAttachmentInput[]
  readonly files?: readonly SideChannelAttachmentInput[]
}

export interface SideChannelPreparedAttachment {
  readonly kind: "image" | "file"
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Buffer
  readonly size: number
}

export interface SideChannelSendResult {
  readonly ok: true
  readonly projectId: string
  readonly sessionKey: string
  readonly outboxRecorded: true
}

export interface SideChannelCronAddRequest {
  readonly project?: string
  readonly projectId?: string
  readonly sessionKey?: string
  readonly session_key?: string
  readonly cronExpr?: string
  readonly cron_expr?: string
  readonly prompt?: string
  readonly exec?: string
  readonly workDir?: string
  readonly work_dir?: string
  readonly description?: string
  readonly silent?: boolean
  readonly mute?: boolean
  readonly sessionMode?: "reuse" | "new_per_run" | "new-per-run"
  readonly session_mode?: "reuse" | "new_per_run" | "new-per-run"
  readonly mode?: string
  readonly timeoutMins?: number
  readonly timeout_mins?: number
}

export interface SideChannelCronAddContext {
  readonly request: SideChannelCronAddRequest
  readonly projectId: string
  readonly sessionKey: string
  readonly target: ReplyTarget
}

export interface SideChannelCronAddResult {
  readonly ok: true
  readonly projectId: string
  readonly sessionKey: string
  readonly jobId: string
  readonly nextRunAt?: string
}

export type SideChannelCronAddHandler = (
  context: SideChannelCronAddContext,
) => Promise<SideChannelCronAddResult>

export interface SideChannelStatus {
  readonly enabled: boolean
  readonly bindAddress?: string
  readonly port?: number
  readonly sendPath: string
  readonly cronAddPath: string
}

export interface ReplyTransportDispatcher {
  dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): Promise<void>
  dispatchSideChannelSend(
    target: ReplyTarget,
    payload: {
      readonly message?: string
      readonly attachments: readonly SideChannelPreparedAttachment[]
    },
  ): Promise<void>
}

export interface ReplyTargetRuntime {
  rememberReplyTarget(target: ReplyTarget): void
  dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): void
  getAgentEnv(projectId: string, sessionKey: string): Record<string, string> | undefined
}
