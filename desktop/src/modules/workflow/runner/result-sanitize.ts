import { sanitizeError } from "@/lib/error-sanitize"

const PRESERVED_STRUCTURED_PATH_KEYS = new Set(["path", "cwd", "stdoutPath", "stderrPath", "promptPath", "lastMessagePath"])
const SENSITIVE_WORKFLOW_RESULT_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|.*(?:secret|token|password|credential|api[-_]?key|session[-_]?key).*)$/i

export function sanitizeWorkflowResultText(value: string): string {
  return sanitizeError(value)
}

export function sanitizeWorkflowPrimaryOutput(
  value: string,
  outputs: Record<string, unknown> | undefined,
): string {
  return outputs?.path === value ? value : sanitizeWorkflowResultText(value)
}

export function sanitizeWorkflowResultValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
  key = "",
): unknown {
  if (typeof value === "string") {
    if (isSensitiveWorkflowResultKey(key) && value) return "[redacted]"
    if (PRESERVED_STRUCTURED_PATH_KEYS.has(key)) return value
    return sanitizeWorkflowResultText(value)
  }
  if (typeof value === "bigint" || value === null || value === undefined) return value
  if (typeof value !== "object") return value
  const cached = seen.get(value)
  if (cached) return cached
  if (Array.isArray(value)) {
    const next: unknown[] = []
    seen.set(value, next)
    value.forEach((item) => next.push(sanitizeWorkflowResultValue(item, seen, key)))
    return next
  }
  const next: Record<string, unknown> = {}
  seen.set(value, next)
  for (const [entryKey, entryValue] of Object.entries(value)) {
    next[entryKey] = sanitizeWorkflowResultValue(entryValue, seen, entryKey)
  }
  return next
}

function isSensitiveWorkflowResultKey(key: string): boolean {
  return SENSITIVE_WORKFLOW_RESULT_KEY_PATTERN.test(key)
}
