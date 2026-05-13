import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }

import type { AgentEvent } from "./types"

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
        payload,
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
    return {
      type: "assistant",
      sdkSessionId,
      message,
      contentBlocks: Array.isArray(message.content) ? message.content : undefined,
      payload,
      ...envelope,
    }
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
  if (errors.length > 0) return errors.join("\n")

  return stringValue(message.stop_reason) ?? "SDK result failed"
}

function toPlainJson(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeJsonValue(value, new WeakSet<object>())
  return isRecord(sanitized) ? sanitized : { value: sanitized }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? toPlainJson(value) : undefined
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
    partialJson: deltaType === "input_json_delta" ? stringValue(delta?.partial_json) : undefined,
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

function sanitizeJsonValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null
  if (value === undefined) return undefined
  if (typeof value === "function" || typeof value === "symbol") return undefined
  if (typeof value === "bigint") return value.toString()
  if (typeof value !== "object") return value
  if (seen.has(value)) return "[Circular]"

  seen.add(value)
  if (Array.isArray(value)) {
    const array = value.map((item) => {
      const sanitized = sanitizeJsonValue(item, seen)
      return sanitized === undefined ? null : sanitized
    })
    seen.delete(value)
    return array
  }

  const record: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const sanitized = sanitizeJsonValue(item, seen)
    if (sanitized !== undefined) record[key] = sanitized
  }
  seen.delete(value)
  return record
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
