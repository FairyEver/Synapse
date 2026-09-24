import { apiKeySecretInlinePatternSource } from "../api-keys/api-key-token"

const REDACTED_VALUE = "[REDACTED]"
const REDACTED_URL = "[URL]"
const REDACTED_PATH = "[PATH]"
const MAX_AUDIT_ERROR_LENGTH = 300

const AUTHORIZATION_PATTERN = /\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const COOKIE_PATTERN = /\bCookie\s*[:=]\s*[^\r\n]+/gi
/**
 * Synapse 自己的 API 密钥。
 *
 * 通知接口的三种形状都把密钥放在请求里，而 URL 段和请求体会出现在路径、`req.url` 和
 * 错误消息里 —— 这些位置前面几个模式都覆盖不到：没有 `Bearer` 前缀，没有 `key=`，
 * 路径形式也不是带 scheme 的 URL。
 */
const API_KEY_PATTERN = new RegExp(apiKeySecretInlinePatternSource, "g")
const SENSITIVE_KEY_PATTERN = String.raw`[A-Za-z0-9_-]*(?:token|api[_-]?key|secret|password|credential)`
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(String.raw`\b(${SENSITIVE_KEY_PATTERN})\s*=\s*[^&\s,;]+`, "gi")
const SENSITIVE_JSON_FIELD_PATTERN = new RegExp(String.raw`(["']?(?:${SENSITIVE_KEY_PATTERN})["']?\s*:\s*)["'][^"']*["']`, "gi")
const URL_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"']+/g
const POSIX_PATH_PATTERN = /(?:\/(?:Users|home|private|tmp|var|opt)\/[^\s,;)]*)/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\s,;)]+/g

export function formatAuditError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = redactAuditText(raw)

  return redacted.length > MAX_AUDIT_ERROR_LENGTH
    ? `${redacted.slice(0, MAX_AUDIT_ERROR_LENGTH)}...`
    : redacted
}

export function redactSensitiveLogText(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value ?? "")
  return redactAuditText(raw)
}

function redactAuditText(raw: string): string {
  return raw
    .replace(AUTHORIZATION_PATTERN, `Authorization: ${REDACTED_VALUE}`)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED_VALUE}`)
    .replace(COOKIE_PATTERN, `Cookie: ${REDACTED_VALUE}`)
    .replace(API_KEY_PATTERN, REDACTED_VALUE)
    .replace(SENSITIVE_JSON_FIELD_PATTERN, `$1"${REDACTED_VALUE}"`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${REDACTED_VALUE}`)
    .replace(URL_PATTERN, REDACTED_URL)
    .replace(POSIX_PATH_PATTERN, REDACTED_PATH)
    .replace(WINDOWS_PATH_PATTERN, REDACTED_PATH)
}
