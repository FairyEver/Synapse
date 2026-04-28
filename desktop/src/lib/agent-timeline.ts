import type {
  SynapseAgentEvent,
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
    agentSessionId: event.agentSessionId,
    threadId: event.threadId,
  }
  switch (event.type) {
    case "text":
      return { ...base, kind: "message", role: "assistant", content: event.content }
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
        metadata: event.metadata,
      }
    case "error":
      return { ...base, kind: "error", message: event.message }
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
  if (event.type === "text" && last?.kind === "message" && last.role === "assistant") {
    if (last.content === event.content || last.content.endsWith(event.content)) return [...current]
    return [...current.slice(0, -1), { ...last, content: `${last.content}${event.content}`, timestamp }]
  }
  if (event.type === "result" && last?.kind === "message" && last.role === "assistant") {
    if (last.content === event.content) return [...current]
    return [...current.slice(0, -1), { ...last, content: event.content, timestamp }]
  }
  if (item.kind === "result" && item.content.trim().length === 0) return [...current]
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
