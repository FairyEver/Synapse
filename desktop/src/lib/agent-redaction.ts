const REDACTED = "[redacted]"

const SENSITIVE_KEY_PATTERN = /api[-_]?key|authorization|cookie|password|credential|secret|session[-_]?key|token/i
const TEXT_ASSIGNMENT_PATTERN = /\b([A-Za-z_][A-Za-z0-9_-]*)(\s*[:=]\s*)(?:(Bearer)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;'"`]+)/gi
const JSON_ASSIGNMENT_PATTERN = /(["'])([A-Za-z_][A-Za-z0-9_-]*)\1(\s*:\s*)(["'])([^"']*)\4/gi
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const AUTHORIZATION_HEADER_PATTERN = /\b(authorization)(\s*:\s*)([^\r\n]+)/gi
const COOKIE_HEADER_PATTERN = /\b((?:set-)?cookie)(\s*:\s*)([^\r\n]+)/gi
const SK_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g
const CIRCULAR_MARKER = "[Circular]"

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "")
  return normalized.includes("secret")
    || normalized.includes("apikey")
    || normalized.includes("authorization")
    || normalized.includes("cookie")
    || normalized.includes("password")
    || normalized.includes("credential")
    || normalized.includes("sessionkey")
    || (normalized.includes("token") && !normalized.endsWith("tokens"))
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      JSON_ASSIGNMENT_PATTERN,
      (match, keyQuote: string, key: string, separator: string, valueQuote: string) =>
        isSensitiveKey(key) ? `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${REDACTED}${valueQuote}` : match,
    )
    .replace(
      AUTHORIZATION_HEADER_PATTERN,
      (_match, key: string, separator: string, rawValue: string) =>
        `${key}${separator}${redactAuthorizationHeaderValue(rawValue)}`,
    )
    .replace(
      COOKIE_HEADER_PATTERN,
      (_match, key: string, separator: string, rawValue: string) =>
        `${key}${separator}${redactCookieHeaderValue(rawValue)}`,
    )
    .replace(
      TEXT_ASSIGNMENT_PATTERN,
      (match, key: string, separator: string, bearer: string | undefined) =>
        isSensitiveKey(key) ? `${key}${separator}${bearer ? `${bearer} ` : ""}${REDACTED}` : match,
    )
    .replace(/(--cookie(?:-jar)?\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, `$1${REDACTED}`)
    .replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED}`)
    .replace(SK_KEY_PATTERN, "[key]")
}

function redactAuthorizationHeaderValue(value: string): string {
  const schemeRedacted = value.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
  if (schemeRedacted !== value) return schemeRedacted
  return value.replace(/^\s*(?:"[^"]*"|'[^']*'|[^\s,;'"`]+)/, REDACTED)
}

function redactCookieHeaderValue(value: string): string {
  return value.replace(/\b([^=;\s'"]+)=([^;\s'"]+)/g, `$1=${REDACTED}`)
}

function redactSensitiveValue(value: unknown, key = "", ancestors = new WeakSet<object>()): unknown {
  if (isSensitiveKey(key)) return REDACTED
  if (typeof value === "string") return redactSensitiveText(value)
  if (!value || typeof value !== "object") return value
  if (ancestors.has(value)) return CIRCULAR_MARKER

  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, "", ancestors))

    const output: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = redactSensitiveValue(childValue, childKey, ancestors)
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

function isSensitiveTextKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

function redactSessionKey(sessionKey: string | undefined): string | undefined {
  return sessionKey ? REDACTED : undefined
}

export {
  isSensitiveKey,
  isSensitiveTextKey,
  redactSessionKey,
  redactSensitiveText,
  redactSensitiveValue,
  REDACTED,
  SENSITIVE_KEY_PATTERN,
}
