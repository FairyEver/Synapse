import { z } from "zod"

export const CLIPBOARD_ERROR_CODES = [
  "INVALID_INPUT",
  "TEXT_TOO_LARGE",
  "READ_FAILED",
  "WRITE_FAILED",
  "CANCELLED",
  "INTERNAL_ERROR",
] as const

export type ClipboardErrorCode = (typeof CLIPBOARD_ERROR_CODES)[number]

export const CLIPBOARD_ERROR_MESSAGES = {
  INVALID_INPUT: "剪贴板输入无效。",
  TEXT_TOO_LARGE: "剪贴板文本超过 1 MiB 限制。",
  READ_FAILED: "读取剪贴板失败。",
  WRITE_FAILED: "写入剪贴板失败。",
  CANCELLED: "剪贴板操作已取消。",
  INTERNAL_ERROR: "剪贴板操作失败。",
} as const satisfies Record<ClipboardErrorCode, string>

export const CLIPBOARD_INVALID_FIELDS = ["request", "text"] as const
export const CLIPBOARD_INVALID_REASONS = [
  "required",
  "type",
  "empty",
  "invalid_unicode",
  "forbidden_character",
  "unknown_field",
] as const

export type ClipboardInvalidField = (typeof CLIPBOARD_INVALID_FIELDS)[number]
export type ClipboardInvalidReason = (typeof CLIPBOARD_INVALID_REASONS)[number]

const invalidInputDataSchema = z.object({
  field: z.enum(CLIPBOARD_INVALID_FIELDS),
  reason: z.enum(CLIPBOARD_INVALID_REASONS),
}).strict()

const invalidInputErrorSchema = z.object({
  code: z.literal("INVALID_INPUT"),
  message: z.literal(CLIPBOARD_ERROR_MESSAGES.INVALID_INPUT),
  retryable: z.literal(false),
  data: invalidInputDataSchema.optional(),
}).strict()

const fixedErrorSchemas = CLIPBOARD_ERROR_CODES
  .filter((code) => code !== "INVALID_INPUT")
  .map((code) => z.object({
    code: z.literal(code),
    message: z.literal(CLIPBOARD_ERROR_MESSAGES[code]),
    retryable: z.literal(false),
  }).strict())

export const clipboardErrorPayloadSchema = z.union([
  invalidInputErrorSchema,
  ...fixedErrorSchemas,
])

export type ClipboardInvalidData = z.infer<typeof invalidInputDataSchema>

export type ClipboardErrorPayload = {
  readonly code: ClipboardErrorCode
  readonly message: (typeof CLIPBOARD_ERROR_MESSAGES)[ClipboardErrorCode]
  readonly retryable: false
  readonly data?: ClipboardInvalidData
}

export class ClipboardError extends Error {
  readonly code: ClipboardErrorCode
  readonly data?: ClipboardInvalidData

  constructor(code: ClipboardErrorCode, data?: ClipboardInvalidData) {
    super(CLIPBOARD_ERROR_MESSAGES[code])
    this.name = "ClipboardError"
    this.code = code
    this.data = data
  }
}

export function createClipboardErrorPayload(
  code: ClipboardErrorCode,
  data?: ClipboardInvalidData,
): ClipboardErrorPayload {
  return {
    code,
    message: CLIPBOARD_ERROR_MESSAGES[code],
    retryable: false,
    ...(code === "INVALID_INPUT" && data ? { data } : {}),
  }
}

export function serializeClipboardError(error: unknown): ClipboardErrorPayload {
  if (error instanceof ClipboardError) {
    return createClipboardErrorPayload(error.code, error.data)
  }
  return createClipboardErrorPayload("INTERNAL_ERROR")
}
