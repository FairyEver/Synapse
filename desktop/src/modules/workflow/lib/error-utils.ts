import { sanitizeError } from "@/lib/error-sanitize"

const MAX_ERROR_MESSAGE_LENGTH = 200

export interface ErrorDiagnostic {
  readonly errorName: string
  readonly errorLength: number
  readonly errorMessage?: string
}

export function errorDiagnostic(error: unknown): ErrorDiagnostic {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
    ...(message.length > 0
      ? { errorMessage: truncateWithEllipsis(sanitizeError(message), MAX_ERROR_MESSAGE_LENGTH) }
      : {}),
  }
}

export function truncateWithEllipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return ".".repeat(Math.max(0, maxLength))
  return `${value.slice(0, maxLength - 3)}...`
}
