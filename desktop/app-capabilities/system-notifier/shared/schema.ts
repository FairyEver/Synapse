import { z } from "zod"

export const SYSTEM_NOTIFICATION_TITLE_MAX_CODE_POINTS = 64
export const SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS = 256
export const SYSTEM_NOTIFICATION_GROUP_MAX_CODE_POINTS = 64
export const SYSTEM_NOTIFICATION_URL_MAX_CODE_POINTS = 2048

export const SYSTEM_NOTIFICATION_INVALID_FIELDS = ["request", "title", "body", "url", "group"] as const
export const SYSTEM_NOTIFICATION_INVALID_REASONS = [
  "required",
  "type",
  "leading_or_trailing_whitespace",
  "forbidden_character",
  "invalid_unicode",
  "too_long",
  // 链接只允许 https：一个 http 地址到了手机上打不开或降级，不如在门口拦下。
  "not_https",
  "unknown_field",
] as const

export type SystemNotificationInvalidField = (typeof SYSTEM_NOTIFICATION_INVALID_FIELDS)[number]
export type SystemNotificationInvalidReason = (typeof SYSTEM_NOTIFICATION_INVALID_REASONS)[number]

export interface SystemNotificationInput {
  readonly title: string
  readonly body: string
  readonly group?: string
  readonly url?: string
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

/**
 * 通知只有一条路，三颗开关分别描述它和它的呈现，字段名就是它门控的那件事：
 *
 * - `sendEnabled` 是**发送总闸**：关掉就不发，哪儿都不会有；
 * - `localEnabled` / `silent` 描述**这台电脑**收到账号消息时的原生呈现（弹不弹、响不响）。
 *   它们不门控发送：人在外面时把本机通知关掉，手机照样收得到。
 */
export const systemNotifierSettingsSchema = z.object({
  schemaVersion: z.literal(3),
  sendEnabled: z.boolean(),
  localEnabled: z.boolean(),
  silent: z.boolean(),
}).strict()

export const systemNotifierSettingsPatchSchema = z.object({
  sendEnabled: z.boolean().optional(),
  localEnabled: z.boolean().optional(),
  silent: z.boolean().optional(),
}).strict().refine(
  (value) => value.sendEnabled !== undefined || value.localEnabled !== undefined || value.silent !== undefined,
  { message: "At least one settings field is required." },
)

export const strictEmptyObjectSchema = z.object({}).strict()

export const defaultSystemNotifierSettings = Object.freeze({
  schemaVersion: 3,
  sendEnabled: true,
  localEnabled: true,
  silent: false,
}) satisfies SystemNotifierSettings

export const systemNotifierTestNotification = Object.freeze({
  title: "System Notifier",
  body: "这是一条测试通知",
}) satisfies SystemNotificationInput

export type SystemNotificationResult = z.infer<typeof systemNotificationResultSchema>
export type SystemNotifierSettings = z.infer<typeof systemNotifierSettingsSchema>
export type SystemNotifierSettingsPatch = z.infer<typeof systemNotifierSettingsPatchSchema>

const ACCEPTED_KEYS = new Set<string>(["title", "body", "url", "group"])

export function validateSystemNotificationInput(request: unknown): SystemNotificationInputValidation {
  if (!isPlainObject(request)) return invalid("request", "type")

  const keys = Object.keys(request)
  if (keys.some((key) => !ACCEPTED_KEYS.has(key))) return invalid("request", "unknown_field")

  const titleError = validateField(request, "title", SYSTEM_NOTIFICATION_TITLE_MAX_CODE_POINTS)
  if (titleError) return titleError
  const bodyError = validateField(request, "body", SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS)
  if (bodyError) return bodyError
  // url 先于 group：链接是这条消息的目的，标签只是装饰，先报前者。
  const urlError = validateOptionalField(request, "url", SYSTEM_NOTIFICATION_URL_MAX_CODE_POINTS)
  if (urlError) return urlError
  if (request.url !== undefined && !isHttpsUrl(request.url as string)) return invalid("url", "not_https")
  const groupError = validateOptionalField(request, "group", SYSTEM_NOTIFICATION_GROUP_MAX_CODE_POINTS)
  if (groupError) return groupError

  return {
    ok: true,
    data: {
      title: request.title as string,
      body: request.body as string,
      ...(request.url !== undefined ? { url: request.url as string } : {}),
      ...(request.group !== undefined ? { group: request.group as string } : {}),
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

/**
 * 可选字段的校验。与 `validateField` 的差别只有一处：字段缺省是合法的。
 *
 * 传了空串仍然按 `required` 报 —— 字段出现了却没有值，和没传是两件事，
 * 静默丢掉会让调用方以为自己发出了一条带标签的消息。
 */
function validateOptionalField(
  request: Record<string, unknown>,
  field: "url" | "group",
  maxCodePoints: number,
): SystemNotificationInvalidInput | null {
  if (!(field in request) || request[field] === undefined) return null
  const value = request[field]
  if (value === "") return invalid(field, "required")
  if (typeof value !== "string") return invalid(field, "type")
  if (value !== value.trim()) return invalid(field, "leading_or_trailing_whitespace")
  if (hasUnpairedSurrogate(value)) return invalid(field, "invalid_unicode")
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) return invalid(field, "forbidden_character")
  if ([...value].length > maxCodePoints) return invalid(field, "too_long")
  // 服务端 zod 的 `.max()` 数的是 UTF-16 码元，不是码点。33 个 emoji 是 33 码点、66 码元：
  // 只数码点就会放行，然后在服务端被打回来，而调用方早已被告知成功。两道都卡，
  // 「桌面放行 ⇒ 服务端放行」才成立。
  if (value.length > maxCodePoints) return invalid(field, "too_long")
  return null
}

/**
 * 比服务端那一条更窄一点：服务端是 `z.url()` 加 `/^https:/`，这里要求字面量
 * `https://` 前缀。窄的一侧在客户端，两边就不会出现「桌面放行、服务端 400」
 * 这种只在联调时才发现的错位。
 */
function isHttpsUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
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
