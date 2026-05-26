const REDACTED_VALUE = "[redacted]"
const SENSITIVE_PARAM_PATTERN = /^(token|key|secret|password|auth|authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|code|signature|sig|credential|session)$/i
const FALLBACK_QUERY_SECRET_PATTERN = /([?&](?:token|key|secret|password|auth|authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|code|signature|sig|credential|session)=)[^&#\s]+/gi
const FALLBACK_USERINFO_PATTERN = /(https?:\/\/)[^/@\s]+@/gi

export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.username) url.username = REDACTED_VALUE
    if (url.password) url.password = REDACTED_VALUE
    for (const param of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_PARAM_PATTERN.test(param)) {
        url.searchParams.set(param, REDACTED_VALUE)
      }
    }
    return url.toString()
  } catch {
    return raw
      .replace(FALLBACK_USERINFO_PATTERN, `$1${REDACTED_VALUE}@`)
      .replace(FALLBACK_QUERY_SECRET_PATTERN, `$1${REDACTED_VALUE}`)
  }
}
