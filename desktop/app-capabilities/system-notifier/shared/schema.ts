import { isAbsolute } from "node:path"
import { z } from "zod"

/** 标题按 UTF-16 码元计数，与服务端的 64 码元上限一致。 */
export const SYSTEM_NOTIFICATION_TITLE_MAX_LENGTH = 64
export const SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS = 256
/**
 * url 与 group 按 UTF-16 码元卡，与服务端 zod 的 `.max()` 同一把尺子，所以名字用 LENGTH
 * 而不是 CODE_POINTS。只有 body 保持码点语义，256 码点最多占服务端允许的 512 码元。
 */
export const SYSTEM_NOTIFICATION_GROUP_MAX_LENGTH = 64
export const SYSTEM_NOTIFICATION_URL_MAX_LENGTH = 2048

export const SYSTEM_NOTIFICATION_INVALID_FIELDS = ["request", "title", "body", "url", "group", "copyOnTap", "imagePath"] as const
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
  // 图片路径与文件本身在暂存阶段才会被拒绝：桌面入口能给出的失败原因比语法检查更多。
  "not_absolute",
  "not_found",
  "not_regular_file",
  "unreadable",
  "permission_denied",
  "unsupported_type",
  "too_large",
  "service_outdated",
] as const

export type SystemNotificationInvalidField = (typeof SYSTEM_NOTIFICATION_INVALID_FIELDS)[number]
export type SystemNotificationInvalidReason = (typeof SYSTEM_NOTIFICATION_INVALID_REASONS)[number]

export interface SystemNotificationInput {
  readonly title: string
  readonly body: string
  readonly group?: string
  readonly url?: string
  /** 为真表示：用户点这条通知时把正文复制到剪贴板。缺省与 false 是同一件事。 */
  readonly copyOnTap?: boolean
  /** 本机图片绝对路径；只由 MCP 直接调用传入。 */
  readonly imagePath?: string
  /** 暂存后的服务端图片 id；内部字段，不对外开放。 */
  readonly imageId?: string
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

const ACCEPTED_KEYS = new Set<string>(["title", "body", "url", "group", "copyOnTap", "imagePath"])

export function validateSystemNotificationInput(request: unknown): SystemNotificationInputValidation {
  if (!isPlainObject(request)) return invalid("request", "type")

  const keys = Object.keys(request)
  if (keys.some((key) => !ACCEPTED_KEYS.has(key))) return invalid("request", "unknown_field")

  const titleError = validateField(request, "title", SYSTEM_NOTIFICATION_TITLE_MAX_LENGTH)
  if (titleError) return titleError
  const bodyError = validateField(request, "body", SYSTEM_NOTIFICATION_BODY_MAX_CODE_POINTS)
  if (bodyError) return bodyError
  // url 先于 group：链接是这条消息的目的，标签只是装饰，先报前者。
  const urlError = validateOptionalField(request, "url", SYSTEM_NOTIFICATION_URL_MAX_LENGTH)
  if (urlError) return urlError
  if (typeof request.url === "string" && !isHttpsUrl(request.url)) return invalid("url", "not_https")
  const groupError = validateOptionalField(request, "group", SYSTEM_NOTIFICATION_GROUP_MAX_LENGTH)
  if (groupError) return groupError
  // 开关排在最后：它是一个布尔，不是内容，没有理由排在任何文本字段前面。
  if (request.copyOnTap !== undefined && typeof request.copyOnTap !== "boolean") {
    return invalid("copyOnTap", "type")
  }
  const imageError = validateImagePath(request)
  if (imageError) return imageError

  return {
    ok: true,
    data: {
      title: request.title as string,
      body: request.body as string,
      ...(request.url !== undefined ? { url: request.url as string } : {}),
      ...(request.group !== undefined ? { group: request.group as string } : {}),
      ...(request.copyOnTap === true ? { copyOnTap: true as const } : {}),
      ...(request.imagePath !== undefined ? { imagePath: request.imagePath as string } : {}),
    },
  }
}

function validateField(
  request: Record<string, unknown>,
  field: "title" | "body",
  maxLength: number,
): SystemNotificationInvalidInput | null {
  if (!(field in request)) return invalid(field, "required")
  const value = request[field]
  if (typeof value !== "string") return invalid(field, "type")
  const shapeError = validateSingleLineShape(value, field)
  if (shapeError) return shapeError
  // 标题与服务端同按码元计数；正文的 256 码点最多占 512 码元，保持既有范围。
  const length = field === "title" ? value.length : [...value].length
  if (length > maxLength) return invalid(field, "too_long")
  return null
}

/**
 * 单行文本的共同形状：非空、无首尾空白、无孤立代理项、无控制字符。
 *
 * 提出来是因为 `validateField`（title/body）与 `validateOptionalField`（url/group）
 * 必须对「什么算单行文本」给出同一个答案 —— 两份各写一遍，往其中一份加一个禁用字符，
 * 另一份就会静默地更松。
 */
function validateSingleLineShape(
  value: string,
  field: SystemNotificationInvalidField,
): SystemNotificationInvalidInput | null {
  if (value === "") return invalid(field, "required")
  if (value !== value.trim()) return invalid(field, "leading_or_trailing_whitespace")
  if (hasUnpairedSurrogate(value)) return invalid(field, "invalid_unicode")
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) return invalid(field, "forbidden_character")
  return null
}

/**
 * 可选字段的校验。与 `validateField` 的差别全在两头：字段缺省是合法的，
 * 长度统一按码元算（必填字段中只有 body 按码点算）。
 */
function validateOptionalField(
  request: Record<string, unknown>,
  field: "url" | "group",
  maxLength: number,
): SystemNotificationInvalidInput | null {
  if (!(field in request) || request[field] === undefined) return null
  const value = request[field]
  if (typeof value !== "string") return invalid(field, "type")
  const shapeError = validateSingleLineShape(value, field)
  if (shapeError) return shapeError
  // 服务端 zod 的 `.max()` 数的是 UTF-16 码元，不是码点，所以这里也按码元卡：
  // 33 个 emoji 是 33 码点、66 码元，只数码点就会放行，然后在服务端被打回来，
  // 而调用方早已被告知成功。码元数天然是码点数的上界，这一条同时覆盖两者，
  // 不需要再来一遍码点检查（那会是一行永远走不到的代码）。
  if (value.length > maxLength) return invalid(field, "too_long")
  return null
}

function validateImagePath(request: Record<string, unknown>): SystemNotificationInvalidInput | null {
  if (!("imagePath" in request) || request.imagePath === undefined) return null
  const value = request.imagePath
  if (typeof value !== "string") return invalid("imagePath", "type")
  if (value === "") return invalid("imagePath", "required")
  const shapeError = validateSingleLineShape(value, "imagePath")
  if (shapeError) return shapeError
  if (value.length > 1024) return invalid("imagePath", "too_long")
  if (!isAbsolute(value)) return invalid("imagePath", "not_absolute")
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
