const REDACTED_VALUE = "[redacted]"
const SENSITIVE_PARAM_PATTERN = /^(token|key|secret|password|auth|authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|code|state|code[-_]?challenge|code[-_]?verifier|signature|sig|credential|session)$/i
const FALLBACK_QUERY_SECRET_PATTERN = /([?&](?:token|key|secret|password|auth|authorization|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|code|state|code[-_]?challenge|code[-_]?verifier|signature|sig|credential|session)=)[^&#\s]+/gi
const FALLBACK_USERINFO_PATTERN = /(https?:\/\/)[^/@\s]+@/gi

export function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ""
    url.password = ""
    for (const param of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_PARAM_PATTERN.test(param)) {
        url.searchParams.set(param, REDACTED_VALUE)
      }
    }
    return url.toString()
  } catch {
    return raw
      .replace(FALLBACK_USERINFO_PATTERN, "$1")
      .replace(FALLBACK_QUERY_SECRET_PATTERN, `$1${REDACTED_VALUE}`)
  }
}
