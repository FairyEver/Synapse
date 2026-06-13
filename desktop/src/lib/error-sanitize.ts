const SENSITIVE_KEY_PATTERN = /\b([A-Za-z0-9_-]*(?:secret|token|api[-_]?key|authorization|cookie|password|credential))\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const PLATFORM_TOKEN_PATTERN = /\b(?:github_pat_[A-Za-z0-9_]{8,}|ghp_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,})\b/g
const SK_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g
const URL_USERINFO_PATTERN = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^@/\s?#]+@/g
const WIN_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+/g
const POSIX_PATH_PATTERN = /(^|[\s("'])\/(?:[^/\s"')]+\/)+[^/\s"'),;]+/g

export interface ErrorLogMetaOptions {
  readonly includeMessage?: boolean
  readonly includeCode?: boolean
  readonly messageLimit?: number
  readonly fallbackMessage?: string
  readonly sanitizeMessage?: (message: string) => string
}

export function sanitizeError(value: string): string {
  return value
    .replace(URL_USERINFO_PATTERN, "$1[redacted]@")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(SENSITIVE_KEY_PATTERN, "$1=[redacted]")
    .replace(PLATFORM_TOKEN_PATTERN, "[key]")
    .replace(SK_KEY_PATTERN, "[key]")
    .replace(WIN_PATH_PATTERN, "[path]")
    .replace(POSIX_PATH_PATTERN, "$1[path]")
    .trim()
}

export function errorLogMessage(value: unknown, fallbackMessage?: string): string {
  const named = value && typeof value === "object"
    ? value as { readonly message?: unknown }
    : undefined
  if (value instanceof Error) return value.message
  if (typeof named?.message === "string") return named.message
  if (typeof value === "string") return value
  return fallbackMessage ?? String(value)
}

export function errorLogName(value: unknown): string {
  const named = value && typeof value === "object"
    ? value as { readonly name?: unknown }
    : undefined
  if (value instanceof Error) return value.name
  if (typeof named?.name === "string") return named.name
  return typeof value
}

export function errorLogCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const code = (value as { readonly code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

export function errorLogMeta(
  value: unknown,
  options: ErrorLogMetaOptions = {},
): Record<string, unknown> {
  const message = errorLogMessage(value, options.fallbackMessage)
  const meta: Record<string, unknown> = {
    errorName: errorLogName(value),
    errorLength: message.length,
  }
  if (options.includeCode) {
    const code = errorLogCode(value)
    if (code) meta.errorCode = code
  }
  if (options.includeMessage && message.length > 0) {
    const sanitize = options.sanitizeMessage ?? sanitizeError
    const sanitized = sanitize(message)
    meta.errorMessage = typeof options.messageLimit === "number" && sanitized.length > options.messageLimit
      ? `${sanitized.slice(0, options.messageLimit)}...`
      : sanitized
  }
  return meta
}
