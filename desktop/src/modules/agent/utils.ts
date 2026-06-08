import type {
  SynapseAgentSessionSummary,
} from "@/types/agent"
import {
  formatAgentInputText,
  formatAgentTranscript,
  formatEntryTime,
  sanitizeAgentRawInput,
} from "@/lib/agent-transcript"

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

function thinkingIndicatorText(frame: number): string {
  const dotCount = ((frame % 4) + 4) % 4
  return `thinking${THINKING_DOT.repeat(dotCount)}`
}

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

export {
  DEFAULT_LOCAL_SESSION_KEY,
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
