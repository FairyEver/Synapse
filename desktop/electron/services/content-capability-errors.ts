type ContentCapabilityErrorCode =
  | "CONTENT_INVALID_INPUT"
  | "CONTENT_NOT_FOUND"
  | "CONTENT_CONFLICT"
  | "CONTENT_FORBIDDEN"

type ContentCapabilityErrorPayload = {
  code: ContentCapabilityErrorCode
  fields?: Record<string, string>
  message: string
  ok: false
  [key: string]: unknown
}

class ContentCapabilityError extends Error {
  readonly code: ContentCapabilityErrorCode
  readonly fields?: Record<string, string>
  readonly details?: Record<string, unknown>

  constructor(
    code: ContentCapabilityErrorCode,
    message: string,
    options: {
      cause?: unknown
      details?: Record<string, unknown>
      fields?: Record<string, string>
    } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = "ContentCapabilityError"
    this.code = code
    this.fields = options.fields
    this.details = options.details
  }
}

function isContentCapabilityError(error: unknown): error is ContentCapabilityError {
  return error instanceof ContentCapabilityError
}

function contentCapabilityErrorPayload(error: ContentCapabilityError): ContentCapabilityErrorPayload {
  return {
    ok: false,
    code: error.code,
    message: error.message,
    ...(error.fields ? { fields: error.fields } : {}),
    ...(error.details ?? {}),
  }
}

export {
  ContentCapabilityError,
  contentCapabilityErrorPayload,
  isContentCapabilityError,
  type ContentCapabilityErrorCode,
  type ContentCapabilityErrorPayload,
}
