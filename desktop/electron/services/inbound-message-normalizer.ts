import type {
  SynapseInboundAttachment,
  SynapseInboundAttachmentKind,
  SynapseInboundDiagnostic,
  SynapseInboundLocation,
  SynapseInboundMessage,
  SynapseInboundNormalizationResult,
} from "../../src/types/connector"
import { allowListAllows } from "./access-policy-service"

type NormalizerOptions = {
  connectorId?: string
  platform?: string
  allowFrom?: string
  now?: () => Date
  saveRaw?: boolean
  shareSessionInChannel?: boolean
  threadIsolation?: boolean
}

type SessionKeyOptions = {
  platform: string
  channelId?: string
  userId: string
  threadId?: string
  rootMessageId?: string
  shareSessionInChannel?: boolean
  threadIsolation?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value !== "string") {
      continue
    }

    const trimmed = value.trim()
    if (trimmed) {
      return trimmed
    }
  }

  return undefined
}

function readBoolean(record: Record<string, unknown>, keys: readonly string[]): boolean {
  for (const key of keys) {
    if (typeof record[key] === "boolean") {
      return record[key]
    }
  }

  return false
}

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
  }

  return undefined
}

function readArray(record: Record<string, unknown>, keys: readonly string[]): unknown[] {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value
    }
  }

  return []
}

function attachmentFrom(value: unknown, kind: SynapseInboundAttachmentKind): SynapseInboundAttachment {
  if (!isRecord(value)) {
    return { kind, ref: String(value) }
  }

  const name = readString(value, ["Name", "name", "FileName", "fileName", "file_name", "filename"])
  const mimeType = readString(value, ["MimeType", "mimeType", "mime_type", "mediaType", "ContentType", "contentType"])
  const ref = readString(value, ["Ref", "ref", "FileID", "fileId", "MediaID", "mediaId", "ID", "id"])
  const url = readString(value, ["URL", "url", "DownloadURL", "downloadUrl"])
  const size = readNumber(value, ["Size", "size", "Bytes", "bytes"])
  const hasInlineData = optionHasInlineData(value)

  return {
    kind,
    ...(name ? { name } : undefined),
    ...(mimeType ? { mimeType } : undefined),
    ...(size !== undefined ? { size } : undefined),
    ...(ref ? { ref } : undefined),
    ...(url ? { url } : undefined),
    ...(hasInlineData ? { hasInlineData } : undefined),
  }
}

function optionHasInlineData(record: Record<string, unknown>): boolean {
  const data = record.Data ?? record.data

  if (typeof data === "string") {
    return data.length > 0
  }

  return Array.isArray(data) && data.length > 0
}

function collectAttachments(record: Record<string, unknown>): SynapseInboundAttachment[] {
  const images = readArray(record, ["Images", "images"]).map((item) => attachmentFrom(item, "image"))
  const files = readArray(record, ["Files", "files"]).map((item) => attachmentFrom(item, "file"))
  const audioValue = record.Audio ?? record.audio
  const audio = audioValue === undefined || audioValue === null
    ? []
    : Array.isArray(audioValue)
      ? audioValue.map((item) => attachmentFrom(item, "audio"))
      : [attachmentFrom(audioValue, "audio")]

  return [...images, ...files, ...audio]
}

function readLocation(record: Record<string, unknown>): SynapseInboundLocation | undefined {
  const value = record.Location ?? record.location
  if (!isRecord(value)) {
    return undefined
  }

  const latitude = readNumber(value, ["Latitude", "latitude", "lat"])
  const longitude = readNumber(value, ["Longitude", "longitude", "lng", "lon"])
  if (latitude === undefined || longitude === undefined) {
    return undefined
  }

  const label = readString(value, ["Label", "label", "name", "address"])
  return {
    latitude,
    longitude,
    ...(label ? { label } : undefined),
  }
}

export function buildConnectorSessionKey(options: SessionKeyOptions): string {
  const channelId = options.channelId || options.userId

  if (options.threadIsolation && options.rootMessageId) {
    return `${options.platform}:${channelId}:root:${options.rootMessageId}`
  }

  if (options.shareSessionInChannel) {
    return options.threadId
      ? `${options.platform}:${channelId}:${options.threadId}`
      : `${options.platform}:${channelId}`
  }

  return options.threadId
    ? `${options.platform}:${channelId}:${options.threadId}:${options.userId}`
    : `${options.platform}:${channelId}:${options.userId}`
}

function diagnosticFor(record: Record<string, unknown> | null, attachmentCount: number, saveRaw: boolean): SynapseInboundDiagnostic {
  return {
    rawKeys: record ? Object.keys(record).sort((a, b) => a.localeCompare(b)) : [],
    attachmentCount,
    savedRaw: saveRaw,
  }
}

export function normalizeInboundMessage(raw: unknown, options: NormalizerOptions = {}): SynapseInboundNormalizationResult {
  if (!isRecord(raw)) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "inbound payload must be an object",
      diagnostic: diagnosticFor(null, 0, options.saveRaw ?? false),
    }
  }

  const attachments = collectAttachments(raw)
  const diagnostic = diagnosticFor(raw, attachments.length, options.saveRaw ?? false)
  const platform = readString(raw, ["Platform", "platform"]) ?? options.platform
  const userId = readString(raw, ["UserID", "userId", "user_id", "FromUserID", "fromUserId"])

  if (!platform) {
    return { ok: false, code: "missing_field", message: "platform is required", diagnostic }
  }

  if (!userId) {
    return { ok: false, code: "missing_field", message: "userId is required", diagnostic }
  }

  const content = readString(raw, ["Content", "content", "Text", "text"]) ?? ""
  const location = readLocation(raw)
  if (!content && attachments.length === 0 && !location) {
    return { ok: false, code: "empty_message", message: "message has no content or attachments", diagnostic }
  }

  if (!allowListAllows(options.allowFrom, userId)) {
    return { ok: false, code: "unauthorized", message: "user is not allowed by allow_from", diagnostic }
  }

  const channelId = readString(raw, ["ChannelID", "channelId", "ChatID", "chatId", "ChannelKey", "channelKey"])
  const threadId = readString(raw, ["ThreadID", "threadId", "MessageThreadID", "messageThreadId"])
  const rootMessageId = readString(raw, ["RootID", "rootId", "RootMessageID", "rootMessageId"])
  const sessionKey = readString(raw, ["SessionKey", "sessionKey"]) ?? buildConnectorSessionKey({
    platform,
    userId,
    channelId,
    threadId,
    rootMessageId,
    shareSessionInChannel: options.shareSessionInChannel,
    threadIsolation: options.threadIsolation,
  })
  const channelKey = readString(raw, ["ChannelKey", "channelKey"]) ?? `${platform}:${channelId || userId}`
  const replyContext = raw.ReplyCtx ?? raw.replyCtx ?? raw.replyContext
  const message: SynapseInboundMessage = {
    ...(options.connectorId ? { connectorId: options.connectorId } : undefined),
    platform,
    sessionKey,
    channelKey,
    ...(readString(raw, ["MessageID", "messageId", "MsgID", "msgId"]) ? { messageId: readString(raw, ["MessageID", "messageId", "MsgID", "msgId"]) } : undefined),
    userId,
    ...(readString(raw, ["UserName", "userName", "username"]) ? { userName: readString(raw, ["UserName", "userName", "username"]) } : undefined),
    ...(readString(raw, ["ChatName", "chatName"]) ? { chatName: readString(raw, ["ChatName", "chatName"]) } : undefined),
    content,
    attachments,
    ...(location ? { location } : undefined),
    ...(readString(raw, ["ExtraContent", "extraContent"]) ? { extraContent: readString(raw, ["ExtraContent", "extraContent"]) } : undefined),
    ...(replyContext !== undefined ? { replyContext } : undefined),
    fromVoice: readBoolean(raw, ["FromVoice", "fromVoice"]),
    ...(readString(raw, ["ModeOverride", "modeOverride"]) ? { modeOverride: readString(raw, ["ModeOverride", "modeOverride"]) } : undefined),
    authorized: true,
    receivedAt: (options.now?.() ?? new Date()).toISOString(),
  }

  return {
    ok: true,
    message,
    diagnostic,
  }
}
