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

export function agentRuntimeCommandDiagnosticSummary(error: unknown): string {
  const slashCommands: string[] = []
  const protectedMessage = rawAgentRuntimeErrorMessage(error).replace(
    /\b(Command\s+|resolving\s+)(\/[A-Za-z0-9][A-Za-z0-9_-]*)(?=\s)/gi,
    (_match, prefix: string, command: string) => {
      const placeholder = `__SYNAPSE_SLASH_COMMAND_${slashCommands.length}__`
      slashCommands.push(command)
      return `${prefix}${placeholder}`
    },
  )
  let summary = agentRuntimeErrorSummary(protectedMessage)
  slashCommands.forEach((command, index) => {
    summary = summary.replaceAll(`__SYNAPSE_SLASH_COMMAND_${index}__`, command)
  })
  return summary
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
