import { z } from "zod"

export const SYSTEM_NOTIFICATION_TITLE_MAX_CODE_POINTS = 64
export const SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS = 256

export const SYSTEM_NOTIFICATION_INVALID_FIELDS = ["request", "title", "body"] as const
export const SYSTEM_NOTIFICATION_INVALID_REASONS = [
  "required",
  "type",
  "leading_or_trailing_whitespace",
  "forbidden_character",
  "invalid_unicode",
  "too_long",
  "unknown_field",
] as const

export type SystemNotificationInvalidField = (typeof SYSTEM_NOTIFICATION_INVALID_FIELDS)[number]
export type SystemNotificationInvalidReason = (typeof SYSTEM_NOTIFICATION_INVALID_REASONS)[number]

export interface SystemNotificationInput {
  readonly title: string
  readonly body: string
}

export interface SystemNotificationInvalidInput {
  readonly ok: false
  readonly code: "INVALID_INPUT"
  readonly error: "Invalid system notification input."
  readonly data: {
    readonly field: SystemNotificationInvalidField
    readonly reason: SystemNotificationInvalidReason
  }
}

export type SystemNotificationInputValidation =
  | { readonly ok: true; readonly data: SystemNotificationInput }
  | SystemNotificationInvalidInput

export const systemNotificationResultSchema = z.object({
  success: z.literal(true),
}).strict()

export const systemNotifierSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean(),
  silent: z.boolean(),
}).strict()

export const systemNotifierSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  silent: z.boolean().optional(),
}).strict().refine((value) => value.enabled !== undefined || value.silent !== undefined, {
  message: "At least one settings field is required.",
})

export const strictEmptyObjectSchema = z.object({}).strict()

export const defaultSystemNotifierSettings = Object.freeze({
  schemaVersion: 1,
  enabled: true,
  silent: false,
}) satisfies SystemNotifierSettings

export const systemNotifierTestNotification = Object.freeze({
  title: "System Notifier",
  body: "这是一条测试通知",
}) satisfies SystemNotificationInput

export type SystemNotificationResult = z.infer<typeof systemNotificationResultSchema>
export type SystemNotifierSettings = z.infer<typeof systemNotifierSettingsSchema>
export type SystemNotifierSettingsPatch = z.infer<typeof systemNotifierSettingsPatchSchema>

export function validateSystemNotificationInput(request: unknown): SystemNotificationInputValidation {
  if (!isPlainObject(request)) return invalid("request", "type")

  const keys = Object.keys(request)
  if (keys.some((key) => key !== "title" && key !== "body")) {
    return invalid("request", "unknown_field")
  }

  const titleError = validateField(request, "title", SYSTEM_NOTIFICATION_TITLE_MAX_CODE_POINTS)
  if (titleError) return titleError
  const bodyError = validateField(request, "body", SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS)
  if (bodyError) return bodyError

  return {
    ok: true,
    data: {
      title: request.title as string,
      body: request.body as string,
    },
  }
}

function validateField(
  request: Record<string, unknown>,
  field: "title" | "body",
  maxCodePoints: number,
): SystemNotificationInvalidInput | null {
  if (!(field in request) || request[field] === "") return invalid(field, "required")
  const value = request[field]
  if (typeof value !== "string") return invalid(field, "type")
  if (value !== value.trim()) return invalid(field, "leading_or_trailing_whitespace")
  if (hasUnpairedSurrogate(value)) return invalid(field, "invalid_unicode")
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) return invalid(field, "forbidden_character")
  if ([...value].length > maxCodePoints) return invalid(field, "too_long")
  return null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index++
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }
  return false
}

function invalid(
  field: SystemNotificationInvalidField,
  reason: SystemNotificationInvalidReason,
): SystemNotificationInvalidInput {
  return {
    ok: false,
    code: "INVALID_INPUT",
    error: "Invalid system notification input.",
    data: { field, reason },
  }
}
