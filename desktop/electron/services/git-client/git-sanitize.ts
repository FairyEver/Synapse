import { sanitizeErrorPreservingPaths } from "../error-sanitize"

const AUTHORIZATION_HEADER_PATTERN = /\b(Authorization\s*[:=]\s*)(Basic|Bearer)\s+[^\s,;]+/gi
const COOKIE_HEADER_PATTERN = /\b((?:Cookie|Set-Cookie)\s*[:=]\s*)[^\r\n]*/gi
const REDACTED_AUTH_HEADER_PLACEHOLDER_PREFIX = "__SYNAPSE_GIT_AUTH_HEADER_REDACTED_"

export function sanitizeGitDiagnosticText(value: string): string {
  const headers: string[] = []
  const protectedAuthValue = value.replace(AUTHORIZATION_HEADER_PATTERN, (_match, prefix: string, scheme: string) => {
    const placeholder = `${REDACTED_AUTH_HEADER_PLACEHOLDER_PREFIX}${headers.length}__`
    headers.push(`${prefix}${scheme} [redacted]`)
    return placeholder
  })
  const protectedValue = protectedAuthValue.replace(COOKIE_HEADER_PATTERN, (_match, prefix: string) => {
    const placeholder = `${REDACTED_AUTH_HEADER_PLACEHOLDER_PREFIX}${headers.length}__`
    headers.push(`${prefix}[redacted]`)
    return placeholder
  })
  return sanitizeErrorPreservingPaths(protectedValue).replace(
    /__SYNAPSE_GIT_AUTH_HEADER_REDACTED_(\d+)__/g,
    (placeholder, index: string) => headers[Number(index)] ?? placeholder,
  )
}
