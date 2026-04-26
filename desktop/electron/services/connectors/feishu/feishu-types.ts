import type { AgentMessage } from "../../agent-runtime"
import type { ConnectorRecord } from "../types"

export const FEISHU_PLATFORM = "feishu"
export const FEISHU_ACCOUNTS_BASE_URL = "https://accounts.feishu.cn"
export const FEISHU_CONNECTOR_SERVICE_ID = "core.feishu-connector"

export type FeishuSetupPollStatus =
  | "pending"
  | "slow_down"
  | "denied"
  | "expired"
  | "completed"
  | "unsupported_platform"
  | "error"

export interface FeishuSetupBeginResult {
  readonly setupId: string
  readonly deviceCode: string
  readonly qrUrl: string
  intervalSeconds: number
  readonly expiresAt: string
}

export interface FeishuSetupPollResult {
  readonly status: FeishuSetupPollStatus
  readonly intervalSeconds?: number
  readonly appId?: string
  readonly ownerOpenId?: string
  readonly message?: string
}

export interface FeishuSetupSession {
  readonly setupId: string
  readonly projectId: string
  readonly deviceCode: string
  readonly qrUrl: string
  intervalSeconds: number
  readonly expiresAt: string
  readonly baseUrl: string
  appId?: string
  appSecret?: string
  ownerOpenId?: string
}

export interface FeishuCredentialInput {
  readonly projectId: string
  readonly appId: string
  readonly appSecret: string
  readonly ownerOpenId?: string
}

export interface FeishuConnectorStatus {
  readonly projectId: string
  readonly configured: boolean
  readonly running: boolean
  readonly connector?: Record<string, unknown>
}

export interface FeishuMention {
  readonly key: string
  readonly id?: {
    readonly open_id?: string
    readonly user_id?: string
    readonly union_id?: string
  }
  readonly name?: string
  readonly tenant_key?: string
}

export interface FeishuMessageEvent {
  readonly event_id?: string
  readonly app_id?: string
  readonly sender: {
    readonly sender_id?: {
      readonly open_id?: string
      readonly user_id?: string
      readonly union_id?: string
    }
    readonly sender_type?: string
    readonly tenant_key?: string
  }
  readonly message: {
    readonly message_id: string
    readonly root_id?: string
    readonly parent_id?: string
    readonly create_time?: string
    readonly update_time?: string
    readonly chat_id: string
    readonly chat_name?: string
    readonly thread_id?: string
    readonly chat_type: string
    readonly message_type: string
    readonly content: string
    readonly mentions?: readonly FeishuMention[]
  }
}

export interface FeishuCardActionEvent {
  readonly open_message_id?: string
  readonly open_chat_id?: string
  readonly context?: {
    readonly open_message_id?: string
    readonly open_chat_id?: string
  }
  readonly operator?: {
    readonly open_id?: string
    readonly user_id?: string
    readonly union_id?: string
    readonly name?: string
  }
  readonly action?: {
    readonly value?: unknown
    readonly tag?: string
    readonly name?: string
    readonly option?: string
    readonly timezone?: string
  }
}

export interface FeishuReplyContext extends Record<string, unknown> {
  readonly kind: "feishu"
  readonly connectorId: string
  readonly projectId: string
  readonly appId?: string
  readonly chatId: string
  readonly chatType: "direct" | "group"
  readonly messageId?: string
  readonly rootId?: string
  readonly threadId?: string
  readonly userId?: string
  readonly sessionKey: string
  readonly replyInThread?: boolean
}

export type FeishuNormalizedInbound =
  | {
      readonly kind: "message"
      readonly message: AgentMessage
      readonly dedupe: NonNullable<ConnectorRecord["dedupe"]>
    }
  | {
      readonly kind: "ignored"
      readonly reason: string
      readonly dedupe?: NonNullable<ConnectorRecord["dedupe"]>
    }

export interface FeishuRuntimeClientHandlers {
  readonly onMessage: (event: FeishuMessageEvent) => void | Promise<void>
  readonly onCardAction: (event: FeishuCardActionEvent) => void | Promise<void>
  readonly onError?: (error: Error) => void
  readonly onReconnecting?: () => void
  readonly onReconnected?: () => void
}

export interface FeishuRuntimeClient {
  start(handlers: FeishuRuntimeClientHandlers): Promise<void>
  stop(): Promise<void>
  fetchBotOpenId(): Promise<string | undefined>
  replyText(ctx: FeishuReplyContext, content: string): Promise<void>
  createText(ctx: FeishuReplyContext, content: string): Promise<void>
  sendCard(ctx: FeishuReplyContext, card: Record<string, unknown>): Promise<void>
  sendImage(ctx: FeishuReplyContext, image: Buffer): Promise<void>
  sendFile(ctx: FeishuReplyContext, fileName: string, file: Buffer): Promise<void>
  addReaction?(messageId: string, emojiType: string): Promise<string | undefined>
  removeReaction?(messageId: string, reactionId: string): Promise<void>
}

export interface FeishuClientFactory {
  create(input: {
    readonly appId: string
    readonly appSecret: string
    readonly logger?: {
      warn(message: string, meta?: Record<string, unknown> | unknown): void
      error(message: string, meta?: Record<string, unknown> | unknown): void
    }
  }): FeishuRuntimeClient
}

export interface StoredFeishuSecret {
  readonly platform: "feishu"
  readonly appId: string
  readonly appSecret: string
}
