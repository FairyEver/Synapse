import type { BuiltinToolErrorCode, BuiltinToolErrorPayload } from "./types"
import { sanitizeError } from "../../../src/lib/error-sanitize"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"

export class BuiltinToolError extends Error {
  readonly code: BuiltinToolErrorCode

  constructor(code: BuiltinToolErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message)
    this.name = "BuiltinToolError"
    this.code = code
    if (options && "cause" in options) {
      this.cause = options.cause
    }
  }
}

export function toBuiltinToolErrorPayload(error: unknown): BuiltinToolErrorPayload {
  if (error instanceof BuiltinToolError) {
    return { code: error.code, message: sanitizeBuiltinToolErrorMessage(error.message) }
  }
  if (error instanceof Error) {
    return { code: "worker_failed", message: sanitizeBuiltinToolErrorMessage(error.message) }
  }
  return { code: "worker_failed", message: sanitizeBuiltinToolErrorMessage(String(error)) }
}

function sanitizeBuiltinToolErrorMessage(message: string): string {
  return sanitizeError(message.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url)))
}
