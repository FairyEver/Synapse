const REDACTED = "[redacted]"

const SENSITIVE_KEY_PATTERN = /api[-_]?key|authorization|cookie|password|credential|secret|token/i
const TEXT_ASSIGNMENT_PATTERN = /\b([A-Za-z_][A-Za-z0-9_-]*)(\s*[:=]\s*)(?:(Bearer)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;'"`]+)/gi
const JSON_ASSIGNMENT_PATTERN = /(["'])([A-Za-z_][A-Za-z0-9_-]*)\1(\s*:\s*)(["'])([^"']*)\4/gi
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "")
  return normalized.includes("secret")
    || normalized.includes("apikey")
    || normalized.includes("authorization")
    || normalized.includes("cookie")
    || normalized.includes("password")
    || normalized.includes("credential")
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
      TEXT_ASSIGNMENT_PATTERN,
      (match, key: string, separator: string, bearer: string | undefined) =>
        isSensitiveKey(key) ? `${key}${separator}${bearer ? `${bearer} ` : ""}${REDACTED}` : match,
    )
    .replace(/(--cookie(?:-jar)?\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, `$1${REDACTED}`)
    .replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED}`)
}

export {
  isSensitiveKey,
  redactSensitiveText,
  REDACTED,
  SENSITIVE_KEY_PATTERN,
}
