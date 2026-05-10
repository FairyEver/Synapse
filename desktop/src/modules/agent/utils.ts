import type {
  SynapseAgentMessageTimelineItem,
  SynapseAgentSessionSummary,
  SynapseAgentTimelineItem,
} from "@/types/agent"

const DEFAULT_LOCAL_SESSION_KEY = "local:renderer"
const THINKING_DOT = "·"

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

function formatAgentTranscript(entries: readonly SynapseAgentTimelineItem[]): string {
  return entries.map((entry) => [
    `${labelForTimelineItem(entry)} ${formatEntryTime(entry.timestamp)}`,
    timelineItemText(entry).trimEnd(),
  ].join("\n")).join("\n\n")
}

function labelForRole(role: SynapseAgentMessageTimelineItem["role"]): string {
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

function labelForTimelineItem(entry: SynapseAgentTimelineItem): string {
  switch (entry.kind) {
    case "message":
      return labelForRole(entry.role)
    case "thinking":
      return "Thinking"
    case "toolCall":
    case "toolResult":
      return "工具"
    case "permissionRequest":
      return "权限"
    case "error":
      return "错误"
    case "result":
      return "结果"
    case "phase":
      return "阶段"
    default: {
      const exhaustive: never = entry
      return exhaustive
    }
  }
}

function timelineItemText(entry: SynapseAgentTimelineItem): string {
  switch (entry.kind) {
    case "message":
    case "thinking":
    case "result":
      return entry.content
    case "toolCall":
      return entry.toolInput ? `${entry.toolName}\n${entry.toolInput}` : entry.toolName
    case "toolResult":
      return entry.content?.trim() || entry.toolName
    case "permissionRequest":
      return entry.toolInput ? `${entry.toolName}\n${entry.toolInput}` : entry.toolName
    case "error":
      return entry.message
    case "phase":
      return entry.errorMessage ?? entry.phase
    default: {
      const exhaustive: never = entry
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
  defaultSessionId,
  defaultSessionKey,
  formatAgentTranscript,
  formatEntryTime,
  sessionLabel,
  thinkingIndicatorText,
}
