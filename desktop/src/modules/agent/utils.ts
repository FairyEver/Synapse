import type {
  SynapseAgentEvent,
  SynapseAgentSessionSummary,
  SynapseAgentTimelineEntry,
} from "@/types/agent"

const DEFAULT_LOCAL_SESSION_KEY = "local:renderer"
const THINKING_DOT = "·"

function agentEventToTimelineEntry(
  event: SynapseAgentEvent,
  timestamp: string,
  index: number,
): SynapseAgentTimelineEntry {
  return {
    id: `event:${timestamp}:${event.type}:${index}`,
    role: roleForEvent(event),
    content: contentForEvent(event),
    timestamp,
  }
}

function localUserTimelineEntry(
  content: string,
  timestamp: string,
  index: number,
): SynapseAgentTimelineEntry {
  return {
    id: `local:${timestamp}:user:${index}`,
    role: "user",
    content,
    timestamp,
  }
}

function contentForEvent(event: SynapseAgentEvent): string {
  switch (event.type) {
    case "text":
    case "thinking":
    case "result":
      return event.content
    case "toolUse":
      return event.toolName
    case "toolResult":
      return event.content ?? event.toolName
    case "permissionRequest":
      return event.toolInput ? `${event.toolName}\n${event.toolInput}` : event.toolName
    case "error":
      return event.message
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

function roleForEvent(event: SynapseAgentEvent): SynapseAgentTimelineEntry["role"] {
  switch (event.type) {
    case "text":
    case "result":
      return "assistant"
    case "toolUse":
    case "toolResult":
      return "tool"
    case "thinking":
    case "permissionRequest":
    case "error":
      return "system"
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

function sessionLabel(session: SynapseAgentSessionSummary): string {
  if (session.platform === "feishu" && session.sourceLabel) return session.sourceLabel
  return session.name || session.sourceLabel || session.sessionKey || DEFAULT_LOCAL_SESSION_KEY
}

function defaultSessionKey(sessions: readonly SynapseAgentSessionSummary[]): string {
  return sessions.find((session) => session.active)?.sessionKey
    ?? sessions[0]?.sessionKey
    ?? DEFAULT_LOCAL_SESSION_KEY
}

function defaultSessionId(sessions: readonly SynapseAgentSessionSummary[]): string | undefined {
  return sessions.find((session) => session.active)?.id
    ?? sessions[0]?.id
}

function formatEntryTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatAgentTranscript(entries: readonly SynapseAgentTimelineEntry[]): string {
  return entries.map((entry) => [
    `${labelForRole(entry.role)} ${formatEntryTime(entry.timestamp)}`,
    entry.content.trimEnd(),
  ].join("\n")).join("\n\n")
}

function labelForRole(role: SynapseAgentTimelineEntry["role"]): string {
  switch (role) {
    case "user":
      return "用户"
    case "assistant":
      return "Agent"
    case "tool":
      return "工具"
    case "system":
      return "系统"
    default: {
      const exhaustive: never = role
      return exhaustive
    }
  }
}

function thinkingIndicatorText(frame: number): string {
  const dotCount = ((frame % 4) + 4) % 4
  return `thinking${THINKING_DOT.repeat(dotCount)}`
}

function agentCliLabel(agentType: string | undefined): string | undefined {
  const normalized = agentType?.trim()
  if (!normalized) return undefined
  if (normalized === "claude-code") return "claudecode"
  return normalized
}

export {
  DEFAULT_LOCAL_SESSION_KEY,
  agentCliLabel,
  agentEventToTimelineEntry,
  defaultSessionId,
  defaultSessionKey,
  formatAgentTranscript,
  formatEntryTime,
  localUserTimelineEntry,
  sessionLabel,
  thinkingIndicatorText,
}
