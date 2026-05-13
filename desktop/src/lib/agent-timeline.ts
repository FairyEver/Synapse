import type {
  SynapseAgentEvent,
  SynapseAgentResultMetadata,
  SynapseAgentTimelineItem,
} from "../types/agent"

type TimelineRecordRole = "user" | "assistant" | "system" | "tool"

export type AgentHistoryRecord = {
  readonly role: TimelineRecordRole
  readonly content: string
  readonly timestamp: string
  readonly metadata?: Record<string, unknown>
}

type TimelineItemContext = {
  readonly id: string
  readonly timestamp: string
  readonly agentType?: string
}

export function agentEventToTimelineItem(
  event: SynapseAgentEvent,
  context: TimelineItemContext,
): SynapseAgentTimelineItem {
  const base = {
    id: context.id,
    timestamp: context.timestamp,
    agentType: context.agentType,
    sdkSessionId: eventId(event, "sdkSessionId"),
    agentSessionId: eventId(event, "agentSessionId"),
    threadId: eventId(event, "threadId"),
  }
  switch (event.type) {
    case "text":
      return { ...base, kind: "message", role: "assistant", content: event.content }
    case "stream":
      return { ...base, kind: "message", role: "assistant", content: streamText(event) }
    case "assistant":
      return { ...base, kind: "message", role: "assistant", content: assistantText(event) }
    case "thinking":
      return { ...base, kind: "thinking", content: event.content }
    case "toolUse":
      return {
        ...base,
        kind: "toolCall",
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolInputRaw: event.toolInputRaw,
      }
    case "toolResult":
      return {
        ...base,
        kind: "toolResult",
        toolName: event.toolName,
        content: event.content,
        status: event.status,
        exitCode: event.exitCode,
        success: event.success,
      }
    case "permissionRequest":
      return {
        ...base,
        kind: "permissionRequest",
        requestId: event.requestId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolInputRaw: event.toolInputRaw,
      }
    case "result":
      return {
        ...base,
        kind: "result",
        content: event.content,
        metadata: resultMetadata(event),
      }
    case "error":
      return { ...base, kind: "error", message: event.message }
    case "sessionInit":
      return {
        ...base,
        kind: "sdkEvent",
        sdkType: "sessionInit",
        label: "SDK event",
        summary: event.model ?? event.tools?.join(", "),
      }
    case "status":
      return {
        ...base,
        kind: "sdkEvent",
        sdkType: "status",
        label: "SDK event",
        summary: event.message ?? event.status ?? undefined,
      }
    case "compactBoundary":
      return {
        ...base,
        kind: "sdkEvent",
        sdkType: "compactBoundary",
        label: "SDK event",
        summary: "compact boundary",
      }
    case "sdkEvent":
      return {
        ...base,
        kind: "sdkEvent",
        sdkType: event.sdkType,
        sdkSubtype: event.sdkSubtype,
        label: "SDK event",
      }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

export function historyRecordToTimelineItem(
  sessionId: string,
  entry: AgentHistoryRecord,
  index: number,
  agentType?: string,
): SynapseAgentTimelineItem {
  const metadata = entry.metadata
  const base = {
    id: `${sessionId}:history:${index}`,
    timestamp: entry.timestamp,
    agentType,
    agentSessionId: stringMetadata(metadata, "agentSessionId"),
    threadId: stringMetadata(metadata, "threadId"),
  }
  switch (stringMetadata(metadata, "agentEventType")) {
    case "toolUse":
      return {
        ...base,
        kind: "toolCall",
        toolName: stringMetadata(metadata, "toolName") ?? firstLine(entry.content),
        toolInput: entry.content.includes("\n") ? entry.content.slice(entry.content.indexOf("\n") + 1) : undefined,
        toolInputRaw: recordMetadata(metadata, "toolInputRaw"),
      }
    case "toolResult":
      return {
        ...base,
        kind: "toolResult",
        toolName: stringMetadata(metadata, "toolName") ?? "tool",
        content: entry.content,
        status: stringMetadata(metadata, "status"),
        exitCode: numberMetadata(metadata, "exitCode"),
        success: booleanMetadata(metadata, "success"),
      }
    case "thinking":
      return { ...base, kind: "thinking", content: entry.content }
    case "permissionRequest":
      return {
        ...base,
        kind: "permissionRequest",
        requestId: stringMetadata(metadata, "requestId") ?? `${sessionId}:permission:${index}`,
        toolName: stringMetadata(metadata, "toolName") ?? firstLine(entry.content),
        toolInput: entry.content.includes("\n") ? entry.content.slice(entry.content.indexOf("\n") + 1) : undefined,
        toolInputRaw: recordMetadata(metadata, "toolInputRaw"),
      }
    case "error":
      return { ...base, kind: "error", message: entry.content }
    default:
      return {
        ...base,
        kind: "message",
        role: entry.role,
        content: entry.content,
        legacy: entry.role === "tool" || entry.role === "system",
      }
  }
}

export function appendAgentTimelineEvent(
  current: readonly SynapseAgentTimelineItem[],
  event: SynapseAgentEvent,
  timestamp: string,
  agentType?: string,
): SynapseAgentTimelineItem[] {
  const item = agentEventToTimelineItem(event, {
    id: `event:${timestamp}:${event.type}:${current.length}`,
    timestamp,
    agentType,
  })
  if (isEmptyTimelineItem(item)) return [...current]
  const last = current.at(-1)
  if ((event.type === "text" || event.type === "stream") && last?.kind === "message" && last.role === "assistant") {
    const content = item.kind === "message" ? item.content : ""
    if (last.content === content || last.content.endsWith(content)) return [...current]
    return [...current.slice(0, -1), { ...last, content: `${last.content}${content}`, timestamp }]
  }
  if (event.type === "result" && last?.kind === "message" && last.role === "assistant") {
    const metadata = resultMetadata(event)
    if (last.content === event.content) {
      return metadata ? [...current.slice(0, -1), { ...last, metadata, timestamp }] : [...current]
    }
    return [...current.slice(0, -1), { ...last, content: event.content, metadata, timestamp }]
  }
  if (item.kind === "result" && item.content.trim().length === 0) return [...current]
  if (item.kind === "result") {
    return [...current, {
      id: item.id,
      kind: "message" as const,
      role: "assistant" as const,
      content: item.content,
      timestamp: item.timestamp,
      agentType: item.agentType,
      sdkSessionId: item.sdkSessionId,
      agentSessionId: item.agentSessionId,
      threadId: item.threadId,
      metadata: item.metadata,
    }]
  }
  return [...current, item]
}

export function localUserTimelineItem(
  content: string,
  timestamp: string,
  index: number,
): SynapseAgentTimelineItem {
  return {
    id: `local:${timestamp}:user:${index}`,
    kind: "message",
    role: "user",
    content,
    timestamp,
  }
}

function isEmptyTimelineItem(item: SynapseAgentTimelineItem): boolean {
  if (item.kind === "message") return item.content.trim().length === 0
  if (item.kind === "thinking") return item.content.trim().length === 0
  if (item.kind === "error") return item.message.trim().length === 0
  return false
}

function firstLine(value: string): string {
  return value.split("\n", 1)[0]?.trim() || "tool"
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" ? value : undefined
}

function numberMetadata(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key]
  return typeof value === "number" ? value : undefined
}

function booleanMetadata(metadata: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = metadata?.[key]
  return typeof value === "boolean" ? value : undefined
}

function recordMetadata(metadata: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = metadata?.[key]
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function eventId(event: SynapseAgentEvent, key: "sdkSessionId" | "agentSessionId" | "threadId"): string | undefined {
  return stringValue(recordValue(event)?.[key])
}

function resultMetadata(event: Extract<SynapseAgentEvent, { type: "result" }>): SynapseAgentResultMetadata | undefined {
  const metadata = {
    ...event.metadata,
    usage: event.metadata?.usage ?? event.usage,
    costUsd: event.metadata?.costUsd ?? event.costUsd,
  }
  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined
}

function assistantText(event: Extract<SynapseAgentEvent, { type: "assistant" }>): string {
  if (typeof event.content === "string") return event.content
  const blocks = event.contentBlocks ?? arrayValue(event.message?.content)
  return textFromBlocks(blocks)
}

function streamText(event: Extract<SynapseAgentEvent, { type: "stream" }>): string {
  if (typeof event.text === "string") return event.text
  const rawEvent = event.event
  const delta = recordValue(rawEvent?.delta)
  return stringValue(delta?.text)
    ?? stringValue(delta?.thinking)
    ?? stringValue(rawEvent?.text)
    ?? ""
}

function textFromBlocks(blocks: readonly unknown[] | undefined): string {
  if (!blocks) return ""
  return blocks.map((block) => {
    if (typeof block === "string") return block
    const record = recordValue(block)
    return stringValue(record?.text) ?? ""
  }).join("")
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
