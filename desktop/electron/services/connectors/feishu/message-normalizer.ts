import type { AgentAttachment, AgentMessage } from "../../agent-runtime"
import type { ConnectorRecord } from "../types"
import type {
  FeishuMessageEvent,
  FeishuMention,
  FeishuNormalizedInbound,
  FeishuReplyContext,
} from "./feishu-types"
import { makeFeishuChannelKey, makeFeishuSessionKey } from "./session"

const MAX_DEDUPE_MESSAGE_IDS = 200

export interface NormalizeFeishuMessageInput {
  readonly projectId: string
  readonly connector: ConnectorRecord
  readonly botOpenId?: string
  readonly event: FeishuMessageEvent
}

export function normalizeFeishuMessage(
  input: NormalizeFeishuMessageInput,
): FeishuNormalizedInbound {
  const event = input.event
  const messageId = event.message.message_id
  const userId = event.sender.sender_id?.open_id
  const chatId = event.message.chat_id
  const chatType = normalizeChatType(event.message.chat_type)
  const rootId = event.message.root_id ?? event.message.thread_id
  const channelKey = makeFeishuChannelKey({ chatId, rootId })
  const channelName = stringValue(event.message.chat_name)
  const dedupe = input.connector.dedupe ?? {
    ttlMs: 60_000,
    lastMessageIds: [],
  }

  if (!messageId || !userId || !chatId) {
    return { kind: "ignored", reason: "missing_required_fields" }
  }
  if (isBeforeIgnoreTime(event.message.create_time, dedupe.ignoreBefore)) {
    return { kind: "ignored", reason: "old_message", dedupe }
  }
  if (dedupe.lastMessageIds?.includes(messageId)) {
    return { kind: "ignored", reason: "duplicate_message", dedupe }
  }
  if (!senderAllowed(input.connector, userId)) {
    return { kind: "ignored", reason: "sender_not_allowed", dedupe }
  }
  if (
    chatType === "group"
    && input.botOpenId
    && !isBotMentioned(input.botOpenId, event.message.mentions)
  ) {
    return { kind: "ignored", reason: "no_bot_mention", dedupe }
  }

  const parsed = contentFromFeishuMessage(event)
  const sessionKey = makeFeishuSessionKey(input.connector.sessionKeyPolicy, {
    chatId,
    userId,
    chatType,
    rootId,
    messageId,
  })
  const replyCtx: FeishuReplyContext = {
    kind: "feishu",
    projectId: input.projectId,
    connectorId: input.connector.id,
    appId: stringValue(input.connector.appId),
    chatId,
    chatType,
    messageId,
    rootId: event.message.root_id,
    threadId: event.message.thread_id,
    userId,
    sessionKey,
    replyInThread: chatType === "group",
  }
  const agentMessage: AgentMessage = {
    projectId: input.projectId,
    sessionKey,
    channelKey,
    platform: "feishu",
    messageId,
    userId,
    chatName: channelName,
    chatType,
    channelName,
    mentions: mentionOpenIds(event.message.mentions),
    createdAt: createTimeToIso(event.message.create_time),
    content: parsed.content,
    attachments: parsed.attachments,
    replyCtx,
  }

  return {
    kind: "message",
    message: agentMessage,
    dedupe: {
      ...dedupe,
      lastMessageIds: nextMessageIds(dedupe.lastMessageIds ?? [], messageId),
    },
  }
}

export function isFeishuAdmin(connector: ConnectorRecord, userId: string): boolean {
  const adminIds = connector.allowlist.adminIds ?? []
  const userIds = connector.allowlist.userIds ?? []
  return adminIds.includes(userId) || userIds.includes(userId)
}

export function senderAllowed(connector: ConnectorRecord, userId: string): boolean {
  if (connector.allowlist.mode === "all") return true
  return [
    ...(connector.allowlist.userIds ?? []),
    ...(connector.allowlist.adminIds ?? []),
  ].includes(userId)
}

function contentFromFeishuMessage(event: FeishuMessageEvent): {
  readonly content: string
  readonly attachments?: readonly AgentAttachment[]
} {
  switch (event.message.message_type) {
    case "text":
      return {
        content: stripMentions(
          textContent(event.message.content),
          event.message.mentions,
        ),
      }
    case "image": {
      const imageKey = stringValue(jsonRecord(event.message.content).image_key)
      return {
        content: "[image]",
        attachments: imageKey ? [{
          kind: "image",
          metadata: { imageKey },
        }] : undefined,
      }
    }
    case "file": {
      const content = jsonRecord(event.message.content)
      const fileKey = stringValue(content.file_key)
      const fileName = stringValue(content.file_name) ?? stringValue(content.name)
      return {
        content: fileName ? `[file] ${fileName}` : "[file]",
        attachments: fileKey ? [{
          kind: "file",
          metadata: { fileKey, fileName },
        }] : undefined,
      }
    }
    default:
      return { content: `[${event.message.message_type}]` }
  }
}

function textContent(raw: string): string {
  const record = jsonRecord(raw)
  const text = stringValue(record.text)
  return text ?? raw
}

function stripMentions(text: string, mentions: readonly FeishuMention[] | undefined): string {
  let next = text
  for (const mention of mentions ?? []) {
    if (mention.key) next = next.split(mention.key).join("")
  }
  return next
    .replace(/<at[^>]*>.*?<\/at>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isBotMentioned(
  botOpenId: string,
  mentions: readonly FeishuMention[] | undefined,
): boolean {
  return (mentions ?? []).some((mention) => mention.id?.open_id === botOpenId)
}

function mentionOpenIds(mentions: readonly FeishuMention[] | undefined): string[] {
  return (mentions ?? [])
    .map((mention) => mention.id?.open_id)
    .filter((value): value is string => Boolean(value))
}

function isBeforeIgnoreTime(createTime: string | undefined, ignoreBefore: string | undefined): boolean {
  if (!createTime || !ignoreBefore) return false
  const createdAt = Number(createTime)
  if (!Number.isFinite(createdAt)) return false
  return createdAt < Date.parse(ignoreBefore)
}

function createTimeToIso(createTime: string | undefined): string | undefined {
  if (!createTime) return undefined
  const ms = Number(createTime)
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms).toISOString()
}

function nextMessageIds(existing: readonly string[], messageId: string): string[] {
  return [messageId, ...existing.filter((value) => value !== messageId)]
    .slice(0, MAX_DEDUPE_MESSAGE_IDS)
}

function normalizeChatType(chatType: string): "direct" | "group" {
  return chatType === "group" ? "group" : "direct"
}

function jsonRecord(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
