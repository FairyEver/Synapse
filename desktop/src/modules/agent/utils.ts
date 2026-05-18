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

function formatEntryTime(timestamp: string): string | undefined {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatAgentTranscript(entries: readonly SynapseAgentTimelineItem[]): string {
  return entries.map((entry) => [
    transcriptLabel(entry),
    timelineItemText(entry).trimEnd(),
  ].join("\n")).join("\n\n")
}

function transcriptLabel(entry: SynapseAgentTimelineItem): string {
  const formattedTime = formatEntryTime(entry.timestamp)
  return formattedTime
    ? `${labelForTimelineItem(entry)} ${formattedTime}`
    : labelForTimelineItem(entry)
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
    case "sdkEvent":
      return "SDK"
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
    case "sdkEvent":
      return [entry.sdkType, entry.sdkSubtype, entry.summary]
        .filter((part): part is string => Boolean(part))
        .join(" ")
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
  if (normalized === "claude-code" || normalized === "claude-sdk" || normalized === "claude-agent-sdk") {
    return "claudecode"
  }
  return normalized
}

const REDACTED = "[redacted]"
const MAX_RAW_INPUT_STRING_LENGTH = 160
const SENSITIVE_RAW_INPUT_KEY_PATTERN = /token|secret|api[-_]?key|authorization|cookie|password|credential/i

function errorLogMeta(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
} {
  const named = error && typeof error === "object"
    ? error as { readonly name?: unknown; readonly message?: unknown }
    : undefined
  const text = error instanceof Error
    ? error.message
    : typeof named?.message === "string"
      ? named.message
      : typeof error === "string"
        ? error
        : String(error)
  const errorName = error instanceof Error
    ? error.name
    : typeof named?.name === "string"
      ? named.name
      : typeof error
  return {
    errorName,
    errorLength: text.length,
  }
}

function sanitizeAgentRawInput(value: unknown, key = ""): unknown {
  if (SENSITIVE_RAW_INPUT_KEY_PATTERN.test(key)) return REDACTED
  if (typeof value === "string") return truncateRawInputString(redactAgentPathLikeValue(value))
  if (Array.isArray(value)) return value.map((item) => sanitizeAgentRawInput(item))
  if (!value || typeof value !== "object") return value

  const sanitized: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    sanitized[childKey] = sanitizeAgentRawInput(childValue, childKey)
  }
  return sanitized
}

function redactAgentPathLikeValue(value: string): string {
  return value
    .replace(/\b[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+/g, "[path redacted]")
    .replace(/(^|[\s("'])\/(?:[^/\s"')]+\/)+[^/\s"'),;]+/g, "$1[path redacted]")
}

function truncateRawInputString(value: string): string {
  if (value.length <= MAX_RAW_INPUT_STRING_LENGTH) return value
  return `${value.slice(0, MAX_RAW_INPUT_STRING_LENGTH)}...[truncated]`
}

export {
  DEFAULT_LOCAL_SESSION_KEY,
  agentCliLabel,
  defaultSessionId,
  defaultSessionKey,
  errorLogMeta,
  formatAgentTranscript,
  formatEntryTime,
  redactAgentPathLikeValue,
  sanitizeAgentRawInput,
  sessionLabel,
  thinkingIndicatorText,
}
