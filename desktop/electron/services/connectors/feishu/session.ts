import type { ConnectorSessionKeyPolicy } from "../types"
import type { FeishuReplyContext } from "./feishu-types"

export interface FeishuSessionInput {
  readonly chatId: string
  readonly userId: string
  readonly chatType: "direct" | "group"
  readonly rootId?: string
  readonly messageId?: string
}

export interface FeishuChannelInput {
  readonly chatId: string
  readonly rootId?: string
}

export function makeFeishuSessionKey(
  policy: ConnectorSessionKeyPolicy | undefined,
  input: FeishuSessionInput,
): string {
  switch (policy?.mode) {
    case "per-channel":
      return `feishu:${input.chatId}`
    case "thread": {
      const threadId = input.rootId || input.messageId || input.userId
      return `feishu:${input.chatId}:${threadId}`
    }
    case "per-user":
    default:
      return `feishu:${input.chatId}:${input.userId}`
  }
}

export function makeFeishuChannelKey(input: FeishuChannelInput): string {
  if (input.rootId) {
    return `feishu:${input.chatId}:root:${input.rootId}`
  }
  return `feishu:${input.chatId}`
}

export function sessionKeyFromFeishuCardAction(input: {
  readonly chatId: string
  readonly userId: string
  readonly value?: Record<string, unknown>
  readonly policy?: ConnectorSessionKeyPolicy
}): string {
  const sessionKey = stringValue(input.value?.sessionKey)
  if (sessionKey) return sessionKey
  return makeFeishuSessionKey(input.policy, {
    chatId: input.chatId,
    userId: input.userId,
    chatType: "group",
    rootId: stringValue(input.value?.rootId),
    messageId: stringValue(input.value?.messageId),
  })
}

export function reconstructFeishuReplyContext(input: {
  readonly projectId: string
  readonly connectorId: string
  readonly sessionKey: string
  readonly appId?: string
  readonly messageId?: string
}): FeishuReplyContext | null {
  const parts = input.sessionKey.split(":")
  if (parts[0] !== "feishu" || !parts[1]) return null
  return {
    kind: "feishu",
    projectId: input.projectId,
    connectorId: input.connectorId,
    appId: input.appId,
    chatId: parts[1],
    chatType: parts.length > 2 ? "group" : "direct",
    userId: parts[2],
    messageId: input.messageId,
    sessionKey: input.sessionKey,
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
