import { createRendererLogger } from "@/app-shell/logging"
import { isSensitiveKey } from "@/lib/agent-redaction"
import { recordDiagnosticBreadcrumb } from "@/lib/diagnostic-context"

const logger = createRendererLogger("ui.tracking")

export type TrackAction =
  | "add"
  | "cancel"
  | "click"
  | "open"
  | "close"
  | "remove"
  | "resize"
  | "scroll"
  | "select"
  | "submit"
  | "toggle"
  | "check"
  | "uncheck"
  | "focus"
  | "blur"
  | "expand"
  | "collapse"
  | "slide"
  | "hover"
  | "complete"
  | "change"

export type TrackDetails = {
  component: string
  name: string
  action: TrackAction
  value?: string | number | boolean | string[] | number[]
  metadata?: Record<string, unknown>
}

export type SanitizedTrackValue =
  | string
  | number
  | boolean
  | null
  | SanitizedTrackValue[]
  | { [key: string]: SanitizedTrackValue }

const LONG_TRACK_VALUE_LIMIT = 300
const LONG_TRACK_VALUE_PREFIX_LENGTH = 120
const SENSITIVE_TRACK_FIELD_PATTERN =
  /(password|token|secret|credential|api[-_]?key|app[-_]?secret|private[-_ ]?key|cookie|authorization|owner[-_ ]?id|user[-_ ]?id)/i
const PATH_TRACK_FIELD_PATTERN =
  /(path|dir|directory|folder|file|base[-_ ]?dir|source[-_ ]?path|target[-_ ]?path|export[-_ ]?path)/i
const SENSITIVE_TRACK_TEXT_PATTERN =
  /\b(api[-_]?key|authorization|cookie|password|credential|secret|token)\b\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/i
const POSIX_ABSOLUTE_TRACK_PATH_PATTERN = /^\/(?:[^/\s"')]+\/)+[^/\s"'),;]+$/
const WINDOWS_ABSOLUTE_TRACK_PATH_PATTERN = /^[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+$/

export function track(details: TrackDetails): void {
  const safeDetails = sanitizeTrackRecord({
    ...details,
    value: details.value,
    metadata: details.metadata,
  })
  recordDiagnosticBreadcrumb({
    action: details.action,
    component: details.component,
    name: details.name,
    value: safeDetails.value,
    metadata: typeof safeDetails.metadata === "object" && safeDetails.metadata !== null && !Array.isArray(safeDetails.metadata)
      ? safeDetails.metadata
      : undefined,
  })
  logger.info(`${details.name}:${details.action}`, safeDetails)
}

export function sanitizeTrackValue(fieldName: string, value: unknown): SanitizedTrackValue {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeTrackValue(fieldName, item))
  }

  if (typeof value === "object") {
    return sanitizeTrackRecord(value as Record<string, unknown>)
  }

  const text = String(value)

  if (SENSITIVE_TRACK_FIELD_PATTERN.test(fieldName) || isSensitiveKey(fieldName)) {
    return "[redacted]"
  }

  if (looksSensitiveTrackText(text)) {
    return "[redacted]"
  }

  if (PATH_TRACK_FIELD_PATTERN.test(fieldName)) {
    return redactPathValue(text)
  }

  if (looksAbsolutePathTrackValue(text)) {
    return redactPathValue(text)
  }

  if (text.length > LONG_TRACK_VALUE_LIMIT) {
    return `${text.slice(0, LONG_TRACK_VALUE_PREFIX_LENGTH)}...（日志自动优化：原始 ${text.length} 字，仅记录前 ${LONG_TRACK_VALUE_PREFIX_LENGTH} 字）`
  }

  return text
}

export function sanitizeTrackRecord(record: Record<string, unknown>): Record<string, SanitizedTrackValue> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, sanitizeTrackValue(key, value)]),
  )
}

export function extractLabel(el: EventTarget | null, maxLen = 40): string | undefined {
  if (!(el instanceof HTMLElement)) return undefined

  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel) return ariaLabel.slice(0, maxLen)

  const title = el.getAttribute("title")
  if (title) return title.slice(0, maxLen)

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const placeholder = el.getAttribute("placeholder")
    if (placeholder) return placeholder.slice(0, maxLen)
    const name = el.getAttribute("name")
    if (name) return name.slice(0, maxLen)
  }

  const text = el.innerText?.trim()
  if (text) {
    const firstLine = text.split("\n")[0].trim()
    return firstLine.slice(0, maxLen) || undefined
  }

  return undefined
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.MutableRefObject<T | null>).current = node
    }
  }
}

function redactPathValue(value: string): string {
  if (!value.trim()) {
    return ""
  }

  const normalized = value.replace(/\\/g, "/")
  const basename = normalized.split("/").filter(Boolean).at(-1)

  return basename ? `[path redacted]/${basename}` : "[path redacted]"
}

function looksSensitiveTrackText(value: string): boolean {
  return SENSITIVE_TRACK_TEXT_PATTERN.test(value)
}

function looksAbsolutePathTrackValue(value: string): boolean {
  return POSIX_ABSOLUTE_TRACK_PATH_PATTERN.test(value)
    || WINDOWS_ABSOLUTE_TRACK_PATH_PATTERN.test(value)
}
