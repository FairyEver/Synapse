import type { BuiltinToolErrorCode, BuiltinToolErrorPayload } from "./types"

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
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error) {
    return { code: "worker_failed", message: error.message }
  }
  return { code: "worker_failed", message: String(error) }
}

