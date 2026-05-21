import type { AgentEvent } from "./types"

export type CompactProgressState = "running" | "completed" | "failed"

export interface CompactProgressEntry {
  readonly kind: "thinking" | "toolUse" | "toolResult" | "error"
  readonly label: string
  readonly content?: string
}

const DEFAULT_MAX_ENTRIES = 10
const DEFAULT_MAX_CONTENT = 160
const REDACTED = "[redacted]"

export function progressEntryFromEvent(event: AgentEvent): CompactProgressEntry | null {
  switch (event.type) {
    case "thinking":
      return {
        kind: "thinking",
        label: "Thinking",
        content: event.content,
      }
    case "toolUse":
      return {
        kind: "toolUse",
        label: event.toolName ? `Using ${event.toolName}` : "Using tool",
        content: event.toolInput,
      }
    case "toolResult":
      return {
        kind: "toolResult",
        label: event.toolName ? `${event.toolName} finished` : "Tool finished",
        content: event.content,
      }
    case "error":
      return {
        kind: "error",
        label: "Failed",
        content: event.message,
      }
    default:
      return null
  }
}

export function appendCompactProgressEntry(
  entries: readonly CompactProgressEntry[],
  entry: CompactProgressEntry,
  maxEntries = DEFAULT_MAX_ENTRIES,
): readonly CompactProgressEntry[] {
  const next = [...entries, entry]
  if (next.length <= maxEntries) return next
  return next.slice(next.length - maxEntries)
}

export function renderCompactProgress(
  entries: readonly CompactProgressEntry[],
  state: CompactProgressState = "running",
): string {
  const title = state === "running"
    ? "Progress"
    : state === "completed"
      ? "Completed"
      : "Failed"
  const lines = [title]
  for (const entry of entries.slice(-DEFAULT_MAX_ENTRIES)) {
    const content = truncateOneLine(redactSensitiveContent(entry.content ?? ""), DEFAULT_MAX_CONTENT)
    lines.push(content ? `- ${entry.label}: ${content}` : `- ${entry.label}`)
  }
  return lines.join("\n")
}

export function compactProgressPayload(
  entries: readonly CompactProgressEntry[],
  state: CompactProgressState = "running",
): Record<string, unknown> {
  return {
    schema: "synapse.compact_progress.v1",
    state,
    entries: entries.slice(-DEFAULT_MAX_ENTRIES).map((entry) => ({
      kind: entry.kind,
      label: entry.label,
      content: truncateOneLine(redactSensitiveContent(entry.content ?? ""), DEFAULT_MAX_CONTENT),
    })),
  }
}

function redactSensitiveContent(value: string): string {
  return value
    .replace(/(["'])(authorization|cookie|set-cookie|token|[a-z0-9_-]*secret|api[_-]?key|password|credential)\1(\s*:\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi, `$1$2$1$3$1${REDACTED}$1`)
    .replace(/\b(authorization)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s'"]+(?:\s+[^\s'"]+)?)/gi, `$1$2${REDACTED}`)
    .replace(/\b(cookie|set-cookie|token|[a-z0-9_-]*secret|api[_-]?key|password|credential)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;'"`]+)/gi, `$1$2${REDACTED}`)
    .replace(/(--cookie(?:-jar)?\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, `$1${REDACTED}`)
}

function truncateOneLine(value: string, maxRunes: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  const runes = [...normalized]
  if (runes.length <= maxRunes) return normalized
  return `${runes.slice(0, maxRunes).join("")}...`
}
