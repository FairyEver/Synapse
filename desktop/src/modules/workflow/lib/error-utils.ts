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
      ? { errorMessage: message.length > MAX_ERROR_MESSAGE_LENGTH ? sanitizeError(message).slice(0, MAX_ERROR_MESSAGE_LENGTH) + "..." : sanitizeError(message) }
      : {}),
  }
}
