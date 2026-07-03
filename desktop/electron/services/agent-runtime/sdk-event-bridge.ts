import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }

import { SYNAPSE_COST_CURRENCY, usdToCny } from "../../../action-packages/shared/cost-currency"
import { sdkResultErrorPresentation } from "./agent-error-messages"
import type {
  AgentArtifactImageMimeType,
  AgentEvent,
  AgentToolResultContentDiagnostics,
  AgentToolResultImageBlock,
  AgentToolResultImageDiagnostic,
} from "./types"
import { isSensitiveKey, redactSensitiveText, REDACTED } from "./redaction"

const MAX_DIAGNOSTIC_TEXT_LENGTH = 240
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
])

export interface AgentEventEnvelope {
  readonly conversationId?: string
  readonly turnId?: string
  readonly providerId?: string
  readonly timestamp?: string
}

export function bridgeSdkMessage(
  message: SDKMessage,
  envelope: AgentEventEnvelope = {},
): AgentEvent | readonly AgentEvent[] {
  const raw = message as unknown as Record<string, unknown>
  const payload = toPlainJson(message)
  const sdkSessionId = stringValue(raw.session_id)

  if (raw.type === "result") {
    const costUsd = numberValue(raw.total_cost_usd)
    const costCny = costUsd === undefined ? undefined : usdToCny(costUsd)
    const costCurrency = costCny === undefined ? undefined : SYNAPSE_COST_CURRENCY
    const usage = recordValue(raw.usage)
    const modelUsage = recordValue(raw.modelUsage)
    const sdkResultUuid = stringValue(raw.uuid)
    if (raw.subtype !== "success" || raw.is_error === true) {
      const errors = Array.isArray(raw.errors)
        ? raw.errors.filter((error): error is string => typeof error === "string")
        : []
      const presentation = sdkResultErrorPresentation(
        stringValue(raw.subtype),
        errors.map(sanitizeDiagnosticText),
      )
      if (presentation) {
        return {
          type: "error",
          message: presentation.message,
          errorKind: presentation.errorKind,
          recoverable: presentation.recoverable,
          sdkSessionId,
          usage,
          modelUsage,
          sdkResultUuid,
          costUsd,
          costCny,
          costCurrency,
          payload: sanitizeResultErrorPayload(payload),
          ...envelope,
        }
      }
      // No actual error messages — stop_reason (e.g. "stop_sequence") is a
      // normal API response indicator, not an error. Bridges that only report
      // a stop_reason are treated as success.
    }

    return {
      type: "result",
      content: typeof raw.result === "string" ? raw.result : "",
      done: true,
      sdkSessionId,
      costUsd,
      costCny,
      costCurrency,
      usage,
      modelUsage,
      sdkResultUuid,
      payload: sanitizeResultSuccessPayload(payload),
      ...envelope,
    }
  }

  if (raw.type === "system" && raw.subtype === "init") {
    return {
      type: "sessionInit",
      sdkSessionId,
      tools: stringListValue(raw.tools),
      mcpServers: recordListValue(raw.mcp_servers),
      model: stringValue(raw.model),
      payload,
      ...envelope,
    }
  }

  if (raw.type === "assistant") {
    const message = recordValue(raw.message) ?? {}
    const contentBlocks = Array.isArray(message.content) ? message.content : undefined
    const assistantEvent: AgentEvent = {
      type: "assistant",
      sdkSessionId,
      message,
      contentBlocks,
      payload: sanitizeAssistantPayload(payload),
      ...envelope,
    }
    const toolUseEvents = toolUseEventsFromBlocks(contentBlocks, sdkSessionId, envelope)
    return toolUseEvents.length > 0 ? [assistantEvent, ...toolUseEvents] : assistantEvent
  }

  if (raw.type === "user") {
    const message = recordValue(raw.message) ?? {}
    const toolResultEvents = toolResultEventsFromBlocks(
      Array.isArray(message.content) ? message.content : undefined,
      sdkSessionId,
      envelope,
    )
    if (toolResultEvents.length > 0) return toolResultEvents
  }

  if (raw.type === "stream_event") {
    const event = recordValue(raw.event) ?? {}
    return {
      type: "stream",
      sdkSessionId,
      event,
      ...streamDeltaFields(event),
      payload,
      ...envelope,
    }
  }

  if (raw.type === "system" && raw.subtype === "status") {
    return {
      type: "status",
      sdkSessionId,
      status: stringValue(raw.status) ?? null,
      payload,
      ...envelope,
    }
  }

  if (raw.type === "system" && raw.subtype === "compact_boundary") {
    return {
      type: "compactBoundary",
      sdkSessionId,
      payload,
      ...envelope,
    }
  }

  return {
    type: "sdkEvent",
    sdkSessionId,
    sdkType: stringValue(raw.type) ?? "unknown",
    sdkSubtype: stringValue(raw.subtype),
    payload,
    ...envelope,
  }
}

function sanitizeResultSuccessPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload }
  delete sanitized.result
  return sanitized
}

function sanitizeResultErrorPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload }
  if (Array.isArray(sanitized.errors)) {
    sanitized.errors = sanitized.errors.map((error) =>
      typeof error === "string" ? sanitizeDiagnosticText(error) : error
    )
  }
  if (typeof sanitized.stop_reason === "string") {
    sanitized.stop_reason = sanitizeDiagnosticText(sanitized.stop_reason)
  }
  return sanitized
}

function sanitizeAssistantPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...payload }
  const message = sanitized.message
  if (isRecord(message)) {
    const content = Array.isArray(message.content) ? message.content : []
    sanitized.message = {
      role: stringValue(message.role),
      contentCount: content.length,
      contentTypes: content.map((block) => {
        const record = isRecord(block) ? block : undefined
        return stringValue(record?.type) ?? typeof block
      }),
    }
  }
  return sanitized
}

function toPlainJson(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeJsonValue(value, new WeakSet<object>())
  return isRecord(sanitized) ? sanitized : { value: sanitized }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? toPlainJson(value) : undefined
}

function toolUseEventsFromBlocks(
  blocks: readonly unknown[] | undefined,
  sdkSessionId: string | undefined,
  envelope: AgentEventEnvelope,
): readonly AgentEvent[] {
  if (!blocks) return []
  return blocks.flatMap((block): readonly AgentEvent[] => {
    const record = isRecord(block) ? block : undefined
    if (record?.type !== "tool_use") return []
    const toolName = stringValue(record.name)
    const toolUseId = stringValue(record.id)
    if (!toolName) return []
    const sanitizedToolInput = record.input
    const toolInputRaw = isRecord(sanitizedToolInput) ? sanitizedToolInput : undefined
    return [{
      type: "toolUse",
      sdkSessionId,
      toolUseId,
      toolName,
      toolInput: stringifyToolInput(sanitizedToolInput),
      toolInputRaw,
      ...envelope,
    }]
  })
}

function toolResultEventsFromBlocks(
  blocks: readonly unknown[] | undefined,
  sdkSessionId: string | undefined,
  envelope: AgentEventEnvelope,
): readonly AgentEvent[] {
  if (!blocks) return []
  return blocks.flatMap((block): readonly AgentEvent[] => {
    const record = isRecord(block) ? block : undefined
    if (record?.type !== "tool_result") return []
    const isError = record.is_error === true
    const toolUseId = stringValue(record.tool_use_id)
    const imageBlocks = toolResultImageBlocks(record.content)
    return [{
      type: "toolResult",
      sdkSessionId,
      toolUseId,
      toolName: toolUseId ?? "tool_result",
      content: toolResultContent(record.content),
      contentDiagnostics: toolResultContentDiagnostics(record.content),
      ...(imageBlocks ? { imageBlocks } : {}),
      status: isError ? "error" : "success",
      success: !isError,
      ...envelope,
    }]
  })
}

function stringifyToolInput(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

function sanitizeToolInputValue(value: unknown, seen = new WeakSet<object>()): unknown {
  const sanitized = sanitizeJsonValue(value, seen)
  return redactToolInputStrings(sanitized)
}

function redactToolInputStrings(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map(redactToolInputStrings)
  if (!isRecord(value)) return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitivePayloadKey(key) ? REDACTED : redactToolInputStrings(item)
  }
  return output
}

function toolResultContent(value: unknown): string | undefined {
  if (typeof value === "string") return redactDiagnosticText(value)
  if (!Array.isArray(value)) return undefined
  const text = value.map((item) => {
    if (typeof item === "string") return item
    const record = isRecord(item) ? item : undefined
    return stringValue(record?.text) ?? ""
  }).join("")
  return text.length > 0 ? redactDiagnosticText(text) : undefined
}

function toolResultContentDiagnostics(value: unknown): AgentToolResultContentDiagnostics {
  if (typeof value === "string") {
    return {
      kind: "string",
      textCharCount: value.length,
      imageCount: 0,
      images: [],
    }
  }
  if (!Array.isArray(value)) {
    return {
      kind: "other",
      textCharCount: 0,
      imageCount: 0,
      images: [],
    }
  }

  const contentTypes: string[] = []
  let textCharCount = 0
  const images: AgentToolResultImageDiagnostic[] = []

  for (const item of value) {
    if (typeof item === "string") {
      textCharCount += item.length
      contentTypes.push("string")
      continue
    }
    const record = isRecord(item) ? item : undefined
    const type = stringValue(record?.type) ?? typeof item
    contentTypes.push(type)
    if (type === "text") {
      textCharCount += stringValue(record?.text)?.length ?? 0
    }
    if (type === "image") {
      const diagnostic = imageDiagnostic(record)
      images.push(diagnostic)
    }
  }

  return {
    kind: "array",
    itemCount: value.length,
    contentTypes,
    textCharCount,
    imageCount: images.length,
    images,
  }
}

function toolResultImageBlocks(value: unknown): readonly AgentToolResultImageBlock[] | undefined {
  if (!Array.isArray(value)) return undefined
  const images: AgentToolResultImageBlock[] = []
  for (const item of value) {
    const record = isRecord(item) ? item : undefined
    if (!record || stringValue(record.type) !== "image") continue
    const file = isRecord(record.file) ? record.file : undefined
    const source = isRecord(record.source) ? record.source : undefined
    const base64 = stringValue(file?.base64)
      ?? stringValue(record.data)
      ?? stringValue(source?.data)
    const mimeType = stringValue(file?.type)
      ?? stringValue(record.mimeType)
      ?? stringValue(record.mime_type)
      ?? stringValue(source?.media_type)
      ?? stringValue(source?.mimeType)
    if (!base64 || !isSupportedImageMimeType(mimeType)) continue
    images.push({ kind: "image", mimeType, base64 })
  }
  return images.length > 0 ? images : undefined
}

function isSupportedImageMimeType(value: string | undefined): value is AgentArtifactImageMimeType {
  return Boolean(value && SUPPORTED_IMAGE_MIME_TYPES.has(value))
}

function imageDiagnostic(record: Record<string, unknown> | undefined): AgentToolResultImageDiagnostic {
  const file = isRecord(record?.file) ? record.file : undefined
  const source = isRecord(record?.source) ? record.source : undefined
  const base64 = stringValue(file?.base64)
    ?? stringValue(record?.data)
    ?? stringValue(source?.data)
  const mimeType = stringValue(file?.type)
    ?? stringValue(record?.mimeType)
    ?? stringValue(record?.mime_type)
    ?? stringValue(source?.media_type)
    ?? stringValue(source?.mimeType)
  const dimensions = dimensionsDiagnostic(file?.dimensions ?? record?.dimensions)
  return {
    ...(mimeType ? { mimeType } : {}),
    ...(base64 ? { base64Length: base64.length } : {}),
    ...(typeof file?.originalSize === "number" ? { originalSize: file.originalSize } : {}),
    ...(dimensions ? { dimensions } : {}),
  }
}

function dimensionsDiagnostic(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined
  const dimensions: Record<string, number> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) {
      dimensions[key] = item
    }
  }
  return Object.keys(dimensions).length > 0 ? dimensions : undefined
}

function streamDeltaFields(event: Record<string, unknown>): {
  readonly blockIndex?: number
  readonly deltaType?: string
  readonly text?: string
  readonly thinking?: string
  readonly partialJson?: string
  readonly inputJsonDeltaLength?: number
  readonly toolUseId?: string
  readonly toolName?: string
} {
  const delta = isRecord(event.delta) ? event.delta : undefined
  const deltaType = stringValue(delta?.type)
  const rawPartialJson = stringValue(delta?.partial_json)
  const contentBlock = isRecord(event.content_block) ? event.content_block : undefined
  const toolUse = stringValue(contentBlock?.type) === "tool_use" ? contentBlock : undefined
  return {
    blockIndex: numberValue(event.index),
    deltaType,
    text: deltaType === "text_delta" ? stringValue(delta?.text) : undefined,
    thinking: deltaType === "thinking_delta" ? stringValue(delta?.thinking) : undefined,
    partialJson: deltaType === "input_json_delta"
      ? redactPartialJson(rawPartialJson)
      : undefined,
    inputJsonDeltaLength: deltaType === "input_json_delta" ? rawPartialJson?.length : undefined,
    toolUseId: stringValue(toolUse?.id),
    toolName: stringValue(toolUse?.name),
  }
}

function recordListValue(value: unknown): readonly Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .map((item) => recordValue(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function stringListValue(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function sanitizeJsonValue(value: unknown, seen: WeakSet<object>, parentKey?: string): unknown {
  if (value === null) return null
  if (value === undefined) return undefined
  if (typeof value === "function" || typeof value === "symbol") return undefined
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "string") {
    if (parentKey && isUrlPayloadKey(parentKey)) return sanitizeUrlDiagnostic(value)
    return parentKey && isDiagnosticPayloadKey(parentKey) ? sanitizeDiagnosticText(value) : value
  }
  if (typeof value !== "object") return value
  if (seen.has(value)) return "[Circular]"

  seen.add(value)
  if (Array.isArray(value)) {
    const array = value.map((item) => {
      const sanitized = sanitizeJsonValue(item, seen, parentKey)
      return sanitized === undefined ? null : sanitized
    })
    seen.delete(value)
    return array
  }

  const source = value as Record<string, unknown>
  const isToolUseBlock = source.type === "tool_use"
  const record: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (isToolUseBlock && key === "input") {
      const sanitized = sanitizeToolInputValue(item, seen)
      if (sanitized !== undefined) record[key] = sanitized
      continue
    }
    if (isSensitivePayloadKey(key)) {
      record[key] = REDACTED
      continue
    }
    if (key === "partial_json" && typeof item === "string") {
      record[key] = redactPartialJson(item)
      continue
    }
    const sanitized = sanitizeJsonValue(item, seen, key)
    if (sanitized !== undefined) record[key] = sanitized
  }
  seen.delete(value)
  return record
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isSensitivePayloadKey(key: string): boolean {
  return isSensitiveKey(key)
}

function isUrlPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "")
  return normalized === "url"
    || normalized === "uri"
    || normalized.endsWith("url")
    || normalized.endsWith("uri")
}

function isDiagnosticPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "")
  return normalized === "message"
    || normalized === "error"
    || normalized === "errors"
    || normalized === "stderr"
    || normalized === "stdout"
    || normalized === "details"
    || normalized === "detail"
    || normalized === "reason"
    || normalized === "stopreason"
    || normalized === "stack"
}

function sanitizeDiagnosticText(value: string): string {
  return truncateDiagnosticText(redactDiagnosticText(value))
}

function sanitizeUrlDiagnostic(value: string): string {
  try {
    const url = new URL(value)
    if (!url.host) return value
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return value
  }
}

function redactDiagnosticText(value: string): string {
  return redactSensitiveText(value)
}

function truncateDiagnosticText(value: string): string {
  return value.length > MAX_DIAGNOSTIC_TEXT_LENGTH
    ? `${value.slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH)}...`
    : value
}

function redactPartialJson(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const redactMatch = (
    match: string,
    keyQuote: string,
    key: string,
    separator: string,
    valueQuote: string,
    rawValue: string,
    closingQuote: string,
  ): string => {
    if (isSensitivePayloadKey(key)) {
      return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${REDACTED}${closingQuote}`
    }
    const redactedValue = redactSensitiveText(rawValue)
    if (redactedValue === rawValue) return match
    return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${redactedValue}${closingQuote}`
  }
  const redacted = value
    .replace(
      /(["'])([^"']+)\1(\s*:\s*)(["'])([^"']*)\4/g,
      (
        match,
        keyQuote: string,
        key: string,
        separator: string,
        valueQuote: string,
        rawValue: string,
      ) => redactMatch(match, keyQuote, key, separator, valueQuote, rawValue, valueQuote),
    )
    .replace(
      /(["'])([^"']+)\1(\s*:\s*)(["'])([^"']*)$/g,
      (
        match,
        keyQuote: string,
        key: string,
        separator: string,
        valueQuote: string,
        rawValue: string,
      ) => redactMatch(match, keyQuote, key, separator, valueQuote, rawValue, ""),
    )
  return truncateDiagnosticText(redacted)
}
