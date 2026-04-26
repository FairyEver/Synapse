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

export interface SideChannelStatus {
  readonly enabled: boolean
  readonly bindAddress?: string
  readonly port?: number
  readonly sendPath: string
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
