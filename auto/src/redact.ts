const REDACTED = '[redacted]'
const SENSITIVE_KEY_PATTERN = String.raw`[A-Za-z0-9_-]*(?:token|api[_-]?key|secret|password|credential)[A-Za-z0-9_-]*`
const AUTHORIZATION_PATTERN = /\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/giu
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu
const COOKIE_PATTERN = /\bCookie\s*[:=]\s*[^\r\n]+/giu
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(String.raw`\b(${SENSITIVE_KEY_PATTERN})\s*=\s*[^&\s,;]+`, 'giu')
const SENSITIVE_JSON_FIELD_PATTERN = new RegExp(String.raw`(["']?(?:${SENSITIVE_KEY_PATTERN})["']?\s*:\s*)["'][^"']*["']`, 'giu')
const ESCAPED_SENSITIVE_JSON_FIELD_PATTERN = new RegExp(String.raw`(\\["'](?:${SENSITIVE_KEY_PATTERN})\\["']\s*:\s*\\["'])[^"']*(\\["'])`, 'giu')

export function redactSensitiveText(value: unknown): string {
  const raw = typeof value === 'string' ? value : String(value ?? '')
  return raw
    .replace(AUTHORIZATION_PATTERN, `Authorization: ${REDACTED}`)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(COOKIE_PATTERN, `Cookie: ${REDACTED}`)
    .replace(ESCAPED_SENSITIVE_JSON_FIELD_PATTERN, `$1${REDACTED}$2`)
    .replace(SENSITIVE_JSON_FIELD_PATTERN, `$1"${REDACTED}"`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${REDACTED}`)
}
