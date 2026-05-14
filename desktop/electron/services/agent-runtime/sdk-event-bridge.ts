import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }

import type { AgentEvent } from "./types"

const REDACTED = "[redacted]"
const PATH_REDACTED = "[path redacted]"
const MAX_DIAGNOSTIC_TEXT_LENGTH = 240

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
    if (raw.subtype !== "success" || raw.is_error === true) {
      return {
        type: "error",
        message: resultErrorMessage(raw),
        sdkSessionId,
        payload: sanitizeResultErrorPayload(payload),
        ...envelope,
      }
    }

    return {
      type: "result",
      content: typeof raw.result === "string" ? raw.result : "",
      done: true,
      sdkSessionId,
      costUsd: numberValue(raw.total_cost_usd),
      usage: recordValue(raw.usage),
      payload,
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
      payload,
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

function resultErrorMessage(message: Record<string, unknown>): string {
  const errors = Array.isArray(message.errors)
    ? message.errors.filter((error): error is string => typeof error === "string")
    : []
  if (errors.length > 0) return errors.map(sanitizeDiagnosticText).join("\n")

  return sanitizeDiagnosticText(stringValue(message.stop_reason) ?? "SDK result failed")
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
    const record = recordValue(block)
    if (record?.type !== "tool_use") return []
    const toolName = stringValue(record.name)
    if (!toolName) return []
    const toolInputRaw = recordValue(record.input)
    return [{
      type: "toolUse",
      sdkSessionId,
      toolName,
      toolInput: stringifyToolInput(toolInputRaw ?? record.input),
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
    const record = recordValue(block)
    if (record?.type !== "tool_result") return []
    const isError = record.is_error === true
    return [{
      type: "toolResult",
      sdkSessionId,
      toolName: stringValue(record.tool_use_id) ?? "tool_result",
      content: toolResultContent(record.content),
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

function toolResultContent(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return undefined
  const text = value.map((item) => {
    if (typeof item === "string") return item
    const record = recordValue(item)
    return stringValue(record?.text) ?? ""
  }).join("")
  return text.length > 0 ? text : undefined
}

function streamDeltaFields(event: Record<string, unknown>): {
  readonly blockIndex?: number
  readonly deltaType?: string
  readonly text?: string
  readonly thinking?: string
  readonly partialJson?: string
} {
  const delta = recordValue(event.delta)
  const deltaType = stringValue(delta?.type)
  return {
    blockIndex: numberValue(event.index),
    deltaType,
    text: deltaType === "text_delta" ? stringValue(delta?.text) : undefined,
    thinking: deltaType === "thinking_delta" ? stringValue(delta?.thinking) : undefined,
    partialJson: deltaType === "input_json_delta"
      ? redactPartialJson(stringValue(delta?.partial_json))
      : undefined,
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

  const record: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
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
  const normalized = key.toLowerCase().replace(/[-_]/g, "")
  if (
    normalized.includes("secret")
    || normalized.includes("apikey")
    || normalized.includes("authorization")
    || normalized.includes("cookie")
    || normalized.includes("password")
    || normalized.includes("credential")
  ) {
    return true
  }
  return normalized.includes("token") && !normalized.endsWith("tokens")
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
  const redacted = value
    .replace(
      /\b(api[-_]?key|authorization|cookie|password|credential|secret|token)\b(\s*[:=]\s*)(?:(Bearer)\s+)?[^\s,;]+/gi,
      (_match, key: string, separator: string, bearer: string | undefined) =>
        `${key}${separator}${bearer ? `${bearer} ` : ""}${REDACTED}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+/g, PATH_REDACTED)
    .replace(/(^|[\s("'])\/(?:[^/\s"')]+\/)+[^/\s"'),;]+/g, `$1${PATH_REDACTED}`)

  return truncateDiagnosticText(redacted)
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
    closingQuote: string,
  ): string => {
    if (!isSensitivePayloadKey(key)) return match
    return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${REDACTED}${closingQuote}`
  }
  return value
    .replace(
      /(["'])([^"']+)\1(\s*:\s*)(["'])([^"']*)\4/g,
      (
        match,
        keyQuote: string,
        key: string,
        separator: string,
        valueQuote: string,
      ) => redactMatch(match, keyQuote, key, separator, valueQuote, valueQuote),
    )
    .replace(
      /(["'])([^"']+)\1(\s*:\s*)(["'])([^"']*)$/g,
      (match, keyQuote: string, key: string, separator: string, valueQuote: string) =>
        redactMatch(match, keyQuote, key, separator, valueQuote, ""),
    )
}
