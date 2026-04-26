import type { AgentEvent, AgentPermissionRequestEvent } from "../../agent-runtime"
import type { ReplyTarget } from "../../reply-target"
import type { ReplyOutboxService } from "../../reply-target"
import type { SideChannelPreparedAttachment } from "../../side-channel"
import type { ReplyTransportDispatcher } from "../../side-channel"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import type { FeishuReplyContext, FeishuRuntimeClient } from "./feishu-types"
import { reconstructFeishuReplyContext } from "./session"

export interface FeishuReplyServiceDeps {
  readonly clientForConnector: (connectorId: string) => FeishuRuntimeClient | undefined
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly outbox?: ReplyOutboxService
  readonly logger?: StructuredLogger
}

export class FeishuReplyService implements ReplyTransportDispatcher {
  private readonly deps: FeishuReplyServiceDeps

  constructor(deps: FeishuReplyServiceDeps) {
    this.deps = deps
  }

  async dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): Promise<void> {
    try {
      switch (event.type) {
        case "text":
          await this.sendText(target, event.content)
          break
        case "result":
          if (event.content.trim()) await this.sendText(target, event.content)
          break
        case "error":
          await this.sendText(target, event.message)
          break
        case "permissionRequest":
          await this.sendPermissionCard(target, event)
          break
        case "toolResult":
          if (event.content?.trim()) await this.sendText(target, event.content)
          break
        case "thinking":
        case "toolUse":
          break
        default: {
          const exhaustive: never = event
          throw new Error(`Unsupported agent event ${(exhaustive as AgentEvent).type}`)
        }
      }
    } catch (error) {
      this.recordFailed(target, event.type, error)
      throw error
    }
  }

  async dispatchSideChannelSend(
    target: ReplyTarget,
    payload: {
      readonly message?: string
      readonly attachments: readonly SideChannelPreparedAttachment[]
    },
  ): Promise<void> {
    try {
      if (payload.message?.trim()) {
        await this.sendText(target, payload.message)
      }
      for (const attachment of payload.attachments) {
        const { client, ctx } = await this.resolveClient(target)
        if (attachment.kind === "image") {
          await client.sendImage(ctx, attachment.bytes)
        } else {
          await client.sendFile(ctx, attachment.fileName, attachment.bytes)
        }
      }
    } catch (error) {
      this.recordFailed(target, "side-channel", error)
      throw error
    }
  }

  private async sendText(target: ReplyTarget, content: string): Promise<void> {
    const { client, ctx } = await this.resolveClient(target)
    if (ctx.messageId) {
      await client.replyText(ctx, content)
    } else {
      await client.createText(ctx, content)
    }
    this.recordAudit("allowed", target, "reply")
  }

  private async sendPermissionCard(
    target: ReplyTarget,
    event: AgentPermissionRequestEvent,
  ): Promise<void> {
    const { client, ctx } = await this.resolveClient(target)
    await client.sendCard(ctx, permissionCard(event, ctx))
    this.recordAudit("allowed", target, "permission_card")
  }

  private async resolveClient(target: ReplyTarget): Promise<{
    readonly client: FeishuRuntimeClient
    readonly ctx: FeishuReplyContext
  }> {
    const ctx = feishuReplyContext(target)
    const client = this.deps.clientForConnector(ctx.connectorId)
    if (!client) throw new Error(`Feishu connector "${ctx.connectorId}" is not running`)
    await this.checkNetworkPermission(target)
    return { client, ctx }
  }

  private async checkNetworkPermission(target: ReplyTarget): Promise<void> {
    const permission = await this.deps.permissionGuard?.check({
      action: "network.connect",
      actor: { kind: "user" },
      resource: "feishu:reply",
      context: {
        projectId: target.projectId,
        sessionKey: target.sessionKey,
        connectorId: target.transport.connectorId,
      },
    })
    if (permission && !permission.allowed) {
      this.recordAudit("denied", target, "reply", permission.reason)
      throw new Error(permission.reason)
    }
  }

  private recordFailed(target: ReplyTarget, eventType: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.deps.outbox?.record({
      target,
      payload: {
        kind: "event",
        content: message,
        metadata: { source: "feishu", eventType },
      },
      status: "failed",
      lastError: message,
    })
    this.recordAudit("failed", target, eventType, message)
    this.deps.logger?.warn("Feishu reply dispatch failed.", {
      error: message,
      projectId: target.projectId,
      sessionKey: target.sessionKey,
      connectorId: target.transport.connectorId,
    })
  }

  private recordAudit(
    outcome: "allowed" | "denied" | "failed",
    target: ReplyTarget,
    eventType: string,
    error?: string,
  ): void {
    this.deps.auditSink?.record({
      action: "network.connect",
      actor: { kind: "connector", id: target.transport.connectorId ?? "feishu" },
      resource: "feishu:reply",
      outcome,
      metadata: {
        projectId: target.projectId,
        sessionKey: target.sessionKey,
        connectorId: target.transport.connectorId,
        eventType,
        error,
      },
    })
  }
}

export function feishuReplyContext(target: ReplyTarget): FeishuReplyContext {
  const ctx = target.replyCtx
  if (ctx?.kind === "feishu") {
    const connectorId = stringValue(ctx.connectorId) ?? target.transport.connectorId
    const projectId = stringValue(ctx.projectId) ?? target.projectId
    const chatId = stringValue(ctx.chatId)
    const sessionKey = stringValue(ctx.sessionKey) ?? target.sessionKey
    if (connectorId && projectId && chatId) {
      return {
        kind: "feishu",
        connectorId,
        projectId,
        appId: stringValue(ctx.appId),
        chatId,
        chatType: ctx.chatType === "group" ? "group" : "direct",
        messageId: stringValue(ctx.messageId) ?? target.messageId,
        rootId: stringValue(ctx.rootId),
        threadId: stringValue(ctx.threadId),
        userId: stringValue(ctx.userId),
        sessionKey,
        replyInThread: booleanValue(ctx.replyInThread),
      }
    }
  }
  const connectorId = target.transport.connectorId ?? "feishu"
  const reconstructed = reconstructFeishuReplyContext({
    projectId: target.projectId,
    connectorId,
    sessionKey: target.sessionKey,
    messageId: target.messageId,
  })
  if (reconstructed) return reconstructed
  throw new Error("Feishu reply target is missing reply context")
}

function permissionCard(
  event: AgentPermissionRequestEvent,
  ctx: FeishuReplyContext,
): Record<string, unknown> {
  const actionBase = {
    requestId: event.requestId,
    sessionKey: ctx.sessionKey,
    projectId: ctx.projectId,
    connectorId: ctx.connectorId,
    rootId: ctx.rootId,
    messageId: ctx.messageId,
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      template: "orange",
      title: { tag: "plain_text", content: "权限确认" },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "plain_text",
          content: event.toolName,
        },
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "允许" },
            type: "primary",
            value: { ...actionBase, behavior: "allow" },
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "拒绝" },
            type: "default",
            value: { ...actionBase, behavior: "deny" },
          },
        ],
      },
    ],
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}
