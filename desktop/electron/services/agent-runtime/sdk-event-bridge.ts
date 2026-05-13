import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"

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
    return {
      type: "result",
      content: resultContent(raw),
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
    return {
      type: "assistant",
      sdkSessionId,
      message: recordValue(raw.message) ?? {},
      payload,
      ...envelope,
    }
  }

  if (raw.type === "stream_event") {
    return {
      type: "stream",
      sdkSessionId,
      event: recordValue(raw.event) ?? {},
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

function resultContent(message: Record<string, unknown>): string {
  if (message.subtype === "success" && typeof message.result === "string") {
    return message.result
  }

  const errors = Array.isArray(message.errors)
    ? message.errors.filter((error): error is string => typeof error === "string")
    : []
  if (errors.length > 0) return errors.join("\n")

  return stringValue(message.stop_reason) ?? ""
}

function toPlainJson(value: unknown): Record<string, unknown> {
  try {
    const json = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "function" || typeof item === "symbol") return undefined
      if (typeof item === "bigint") return item.toString()
      return item
    })
    if (!json) return {}
    const parsed = JSON.parse(json) as unknown
    return isRecord(parsed) ? parsed : { value: parsed }
  } catch {
    return { value: String(value) }
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? toPlainJson(value) : undefined
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
