import type {
  SynapseAgentMessageTimelineItem,
  SynapseAgentPermissionRequestTimelineItem,
  SynapseAgentSessionSummary,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import {
  isSensitiveKey,
  redactSensitiveText,
  REDACTED,
} from "@/lib/agent-redaction"

const DEFAULT_LOCAL_SESSION_KEY = "local:renderer"
const THINKING_DOT = "·"

function sessionLabel(session: SynapseAgentSessionSummary): string {
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
  return transcriptSections(entries).map((section) => [
    section.label,
    section.text.trimEnd(),
  ].join("\n")).join("\n\n")
}

type TranscriptSection = {
  label: string
  text: string
  toolName?: string
  toolUseId?: string
}

function transcriptSections(entries: readonly SynapseAgentTimelineItem[]): readonly TranscriptSection[] {
  const sections: TranscriptSection[] = []
  for (const entry of entries) {
    if (entry.kind === "toolResult") {
      const section = matchingToolSection(sections, entry)
      if (section) {
        section.text = `${section.text.trimEnd()}\n\n输出\n${timelineItemText(entry).trimEnd()}`
        continue
      }
    }
    sections.push({
      label: transcriptLabel(entry),
      text: timelineItemText(entry),
      toolName: entry.kind === "toolCall" ? entry.toolName : undefined,
      toolUseId: entry.kind === "toolCall" ? entry.toolUseId : undefined,
    })
  }
  return sections
}

function matchingToolSection(
  sections: readonly TranscriptSection[],
  entry: Extract<SynapseAgentTimelineItem, { kind: "toolResult" }>,
): TranscriptSection | undefined {
  if (entry.toolUseId) {
    return [...sections].reverse().find((item) => item.toolUseId === entry.toolUseId)
  }
  const latest = sections.at(-1)
  return latest?.toolUseId || latest?.toolName !== entry.toolName ? undefined : latest
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
      if (isAskUserQuestionEntry(entry)) return "待回答"
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
      return toolCallTranscriptText(entry)
    case "toolResult":
      return entry.content?.trim() || entry.toolName
    case "permissionRequest": {
      const permissionEntry = entry
      if (isAskUserQuestionEntry(permissionEntry)) {
        return userQuestionText(permissionEntry) || permissionEntry.toolName
      }
      return permissionEntry.toolInput
        ? `${permissionEntry.toolName}\n${permissionEntry.toolInput}`
        : permissionEntry.toolName
    }
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

function isAskUserQuestionEntry(entry: SynapseAgentTimelineItem): boolean {
  return entry.kind === "permissionRequest" && entry.toolName === "AskUserQuestion"
}

function userQuestionText(entry: SynapseAgentPermissionRequestTimelineItem): string {
  const questions = entry.questions ?? []
  return questions.map((question, index) => {
    const lines = [
      question.header ? `${question.header}: ${question.question}` : question.question,
      ...(question.options?.map((option) =>
        option.description ? `- ${option.label}: ${option.description}` : `- ${option.label}`) ?? []),
    ]
    return questions.length > 1 ? `${index + 1}. ${lines.join("\n")}` : lines.join("\n")
  }).join("\n\n")
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

const MAX_RAW_INPUT_STRING_LENGTH = 160

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
  if (isSensitiveKey(key)) return REDACTED
  if (typeof value === "string") return truncateRawInputString(formatAgentInputText(value))
  if (Array.isArray(value)) return value.map((item) => sanitizeAgentRawInput(item))
  if (!value || typeof value !== "object") return value

  const sanitized: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    sanitized[childKey] = sanitizeAgentRawInput(childValue, childKey)
  }
  return sanitized
}

function formatAgentInputText(value: string): string {
  return redactSensitiveText(value)
}

function toolCallTranscriptText(entry: Extract<SynapseAgentTimelineItem, { kind: "toolCall" }>): string {
  const input = entry.toolInputRaw
    ? JSON.stringify(sanitizeAgentRawInput(entry.toolInputRaw), null, 2)
    : entry.toolInput
      ? formatAgentInputText(entry.toolInput)
      : undefined
  if (!input) return entry.toolName
  return `${entry.toolName}\n${input}`
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
  formatAgentInputText,
  formatEntryTime,
  sanitizeAgentRawInput,
  sessionLabel,
  thinkingIndicatorText,
}
