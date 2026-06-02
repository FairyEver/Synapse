const SENSITIVE_KEY_PATTERN = /\b(secret|token|api[-_]?key|authorization|cookie|password|credential)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const SK_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g
const URL_USERINFO_PATTERN = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^@/\s?#]+@/g
const WIN_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+/g
const POSIX_PATH_PATTERN = /(^|[\s("'])\/(?:[^/\s"')]+\/)+[^/\s"'),;]+/g

export function sanitizeError(value: string): string {
  return value
    .replace(URL_USERINFO_PATTERN, "$1[redacted]@")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(SENSITIVE_KEY_PATTERN, "$1=[redacted]")
    .replace(SK_KEY_PATTERN, "[key]")
    .replace(WIN_PATH_PATTERN, "[path]")
    .replace(POSIX_PATH_PATTERN, "$1[path]")
    .trim()
}
