/**
 * Phase 0.3 — Zod-backed IPC validation.
 *
 * Wraps a ZodSchema parse and converts ZodError into our structured
 * IpcValidationError so the bridge sees a clean { code, message, details }
 * payload regardless of which library produced the issue.
 */

import type { ZodSchema, ZodIssue } from "zod"
import { IpcValidationError } from "./errors"

export interface ValidatedRequest<T> {
  ok: true
  value: T
}

export interface ValidationFailure {
  ok: false
  error: IpcValidationError
}

export type ValidationResult<T> = ValidatedRequest<T> | ValidationFailure

export function validateRequest<T>(
  channel: string,
  schema: ZodSchema<T>,
  raw: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(raw)
  if (result.success) {
    return { ok: true, value: result.data }
  }
  const issues = (result.error.issues ?? []).map((issue: ZodIssue) => ({
    path: issue.path,
    message: issue.message,
  }))
  return { ok: false, error: new IpcValidationError(channel, issues) }
}

export function tryValidateResponse<T>(
  channel: string,
  schema: ZodSchema<T> | undefined,
  value: unknown,
): T {
  if (!schema) return value as T
  const result = schema.safeParse(value)
  if (!result.success) {
    const issues = (result.error.issues ?? []).map((issue: ZodIssue) => ({
      path: issue.path,
      message: issue.message,
    }))
    throw new IpcValidationError(channel, issues)
  }
  return result.data
}
