export type TerminalErrorCategory =
  | "caller_context"
  | "authorization"
  | "validation"
  | "not_found"
  | "conflict"
  | "lifecycle"
  | "lease"
  | "revision"
  | "idempotency"
  | "cursor"
  | "capability"
  | "quota"
  | "persistence"
  | "internal"

export type TerminalErrorCode =
  | "caller_identity_required"
  | "permission_denied"
  | "validation_error"
  | "invalid_argument"
  | "not_found"
  | "unsupported"
  | "revision_conflict"
  | "idempotency_conflict"
  | "idempotency_expired"
  | "control_busy"
  | "lease_invalid"
  | "lease_expired"
  | "lifecycle_conflict"
  | "watermark_ahead"
  | "cursor_invalid"
  | "paste_mode_unavailable"
  | "normal_stop_unsupported"
  | "force_stop_unsupported"
  | "persistence_unavailable"
  | "quota_exceeded"
  | "rate_limited"
  | "delivery_uncertain"
  | "internal_error"

export type TerminalErrorPayload = {
  readonly code: TerminalErrorCode
  readonly category: TerminalErrorCategory
  readonly retryable: boolean
  readonly retryAfter?: string
  readonly correlationId: string
  readonly details?: Readonly<Record<string, unknown>>
  readonly message?: string
}

export type TerminalOutcome =
  | "accepted"
  | "partial"
  | "delivery_uncertain"
  | "no_op"
  | "failed_after_identity_created"

export type TerminalResultEnvelope<T> = {
  readonly ok: true
  readonly correlationId: string
  readonly outcome: TerminalOutcome
  readonly data: T
}

export type TerminalErrorEnvelope = {
  readonly ok: false
  readonly error: TerminalErrorPayload
}

export class TerminalContractError extends Error {
  readonly payload: TerminalErrorPayload

  constructor(input: Omit<TerminalErrorPayload, "correlationId"> & {
    readonly correlationId?: string
  }) {
    super(input.message ?? input.code)
    this.name = "TerminalContractError"
    this.payload = {
      correlationId: input.correlationId ?? createCorrelationId(),
      ...input,
    }
  }
}

export function terminalResult<T>(
  data: T,
  outcome: TerminalOutcome = "accepted",
  correlationId = createCorrelationId(),
): TerminalResultEnvelope<T> {
  return {
    ok: true,
    correlationId,
    outcome,
    data,
  }
}

export function terminalErrorEnvelope(error: unknown): TerminalErrorEnvelope {
  if (error instanceof TerminalContractError) {
    return { ok: false, error: error.payload }
  }
  return {
    ok: false,
    error: {
      code: "internal_error",
      category: "internal",
      retryable: false,
      correlationId: createCorrelationId(),
      message: "Terminal operation failed.",
    },
  }
}

function createCorrelationId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `terminal-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function terminalContractError(
  code: TerminalErrorCode,
  category: TerminalErrorCategory,
  options: {
    readonly retryable?: boolean
    readonly retryAfter?: string
    readonly details?: Readonly<Record<string, unknown>>
    readonly message?: string
    readonly correlationId?: string
  } = {},
): TerminalContractError {
  return new TerminalContractError({
    code,
    category,
    retryable: options.retryable ?? false,
    ...(options.retryAfter ? { retryAfter: options.retryAfter } : {}),
    ...(options.details ? { details: options.details } : {}),
    ...(options.message ? { message: options.message } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  })
}
