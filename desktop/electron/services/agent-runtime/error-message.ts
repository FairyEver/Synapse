import {
  errorLogMessage,
  sanitizeError,
  sanitizeErrorPreservingPaths,
} from "../error-sanitize"
import { redactSensitiveText } from "./redaction"

export const AGENT_RUNTIME_ERROR_MESSAGE_MAX_LENGTH = 240

export function agentRuntimeErrorMessage(error: unknown, fallbackMessage?: string): string {
  return truncateRunes(
    normalizeRedactedText(sanitizeErrorPreservingPaths(redactSensitiveText(rawAgentRuntimeErrorMessage(error, fallbackMessage)))),
    AGENT_RUNTIME_ERROR_MESSAGE_MAX_LENGTH,
  )
}

export function rawAgentRuntimeErrorMessage(error: unknown, fallbackMessage?: string): string {
  return errorLogMessage(error, fallbackMessage)
}

export function agentRuntimeErrorSummary(error: unknown, fallbackMessage?: string): string {
  return sanitizeError(agentRuntimeErrorMessage(error, fallbackMessage))
    .replace(/\[path\]/g, "[path redacted]")
}

function truncateRunes(value: string, maxLength: number): string {
  return [...value].slice(0, maxLength).join("")
}

function normalizeRedactedText(value: string): string {
  return value.replace(
    /\b(authorization)(\s*[:=]\s*)\[redacted\]\s+\[redacted\]/gi,
    "$1$2[redacted]",
  )
}
