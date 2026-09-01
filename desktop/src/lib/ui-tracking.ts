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
  | "drop"
  | "change"

export type TrackDetails = {
  component: string
  name: string
  action: TrackAction
  eventKey?: string
  category?: TrackCategory
  outcome?: TrackOutcome
  durationMs?: number
  value?: string | number | boolean | string[] | number[]
  metadata?: Record<string, unknown>
}

export type TrackCategory = "lifecycle" | "navigation" | "interaction" | "operation" | "error"
export type TrackOutcome = "success" | "failure" | "cancelled"

export type TrackOperationDetails = {
  component: string
  eventKey: string
  name?: string
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
const STABLE_EVENT_KEY_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u
const STABLE_DIMENSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu
const HIGH_FREQUENCY_ACTIONS = new Set<TrackAction>(["resize", "scroll", "slide"])
const lastRemoteEmission = new Map<string, number>()
const pendingRemoteEmission = new Map<string, {
  telemetry: Record<string, SanitizedTrackValue>
  timer: ReturnType<typeof setTimeout>
}>()
const REMOTE_SAMPLE_INTERVAL_MS = 1_000
const trackingContext: { moduleId?: string; windowType?: string } = {}

export function track(details: TrackDetails): void {
  try {
    const telemetry = buildRemoteTelemetry(details)
    const safeDetails = sanitizeTrackRecord({
      ...details,
      ...(telemetry ? { telemetry } : {}),
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
  } catch {
    return
  }
}

export function startTrackedOperation(
  details: TrackOperationDetails,
): (outcome: TrackOutcome) => void {
  const startedAt = trackingNow()
  let finished = false

  return (outcome) => {
    if (finished) return
    finished = true
    track({
      component: details.component,
      name: details.name ?? details.eventKey,
      action: "complete",
      eventKey: details.eventKey,
      category: "operation",
      outcome,
      durationMs: Math.max(0, trackingNow() - startedAt),
    })
  }
}

function trackingNow(): number {
  try {
    return typeof performance === "undefined" ? Date.now() : performance.now()
  } catch {
    try {
      return Date.now()
    } catch {
      return 0
    }
  }
}

export async function runTrackedOperation<T>(
  details: TrackOperationDetails,
  operation: () => Promise<T>,
  isCancelled: (error: unknown) => boolean = isCancelledError,
): Promise<T> {
  const finish = startTrackedOperation(details)
  try {
    const result = await operation()
    finish("success")
    return result
  } catch (error) {
    finish(isCancelled(error) ? "cancelled" : "failure")
    throw error
  }
}

function buildRemoteTelemetry(details: TrackDetails): Record<string, SanitizedTrackValue> | null {
  const component = stableDimension(details.component) ?? "unknown"
  const eventKey = stableEventKey(details.eventKey) ?? `${component}.${details.action}`
  const samplingKey = `${eventKey}:${details.action}`
  const moduleId = stableDimension(trackingContext.moduleId)
  const windowType = stableDimension(trackingContext.windowType) ?? "main"
  const telemetry: Record<string, SanitizedTrackValue> = {
    category: details.category ?? "interaction",
    eventKey,
    component,
    action: details.action,
    ...(details.outcome ? { outcome: details.outcome } : {}),
    ...(typeof details.durationMs === "number" && Number.isFinite(details.durationMs)
      ? { durationMs: Math.max(0, Math.round(details.durationMs)) }
      : {}),
    ...(moduleId ? { moduleId } : {}),
    windowType,
  }
  if (HIGH_FREQUENCY_ACTIONS.has(details.action)) {
    const now = Date.now()
    const previous = lastRemoteEmission.get(samplingKey) ?? 0
    const elapsed = now - previous
    if (elapsed < REMOTE_SAMPLE_INTERVAL_MS) {
      scheduleFinalRemoteEmission(samplingKey, eventKey, details.action, telemetry, REMOTE_SAMPLE_INTERVAL_MS - elapsed)
      return null
    }
    clearPendingRemoteEmission(samplingKey)
    lastRemoteEmission.set(samplingKey, now)
  }
  return telemetry
}

function stableEventKey(value: unknown): string | null {
  return typeof value === "string" && STABLE_EVENT_KEY_PATTERN.test(value) && !UUID_LIKE_PATTERN.test(value)
    ? value
    : null
}

function stableDimension(value: unknown): string | null {
  return typeof value === "string" && STABLE_DIMENSION_PATTERN.test(value) && !UUID_LIKE_PATTERN.test(value)
    ? value
    : null
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

export function resetRemoteTrackingForTests(): void {
  lastRemoteEmission.clear()
  for (const pending of pendingRemoteEmission.values()) clearTimeout(pending.timer)
  pendingRemoteEmission.clear()
}

export function updateTrackingContext(next: { moduleId?: string; windowType?: string }): void {
  Object.assign(trackingContext, next)
}

function scheduleFinalRemoteEmission(
  samplingKey: string,
  eventKey: string,
  action: TrackAction,
  telemetry: Record<string, SanitizedTrackValue>,
  delayMs: number,
): void {
  const current = pendingRemoteEmission.get(samplingKey)
  if (current) {
    current.telemetry = telemetry
    return
  }
  const pending = {
    telemetry,
    timer: setTimeout(() => {
      try {
        const latest = pendingRemoteEmission.get(samplingKey)
        if (!latest) return
        pendingRemoteEmission.delete(samplingKey)
        lastRemoteEmission.set(samplingKey, Date.now())
        logger.info(`${eventKey}:${action}:final`, { telemetry: latest.telemetry })
      } catch {
        pendingRemoteEmission.delete(samplingKey)
      }
    }, delayMs),
  }
  pending.timer.unref?.()
  pendingRemoteEmission.set(samplingKey, pending)
}

function clearPendingRemoteEmission(samplingKey: string): void {
  const pending = pendingRemoteEmission.get(samplingKey)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingRemoteEmission.delete(samplingKey)
}

export function installNativeDataTrackCapture(root: Document = document): () => void {
  const listeners = [
    ["click", "click"],
    ["dblclick", "click"],
    ["change", "change"],
    ["submit", "submit"],
    ["drop", "drop"],
    ["dragend", "drop"],
    ["scroll", "scroll"],
  ] as const satisfies ReadonlyArray<readonly [keyof DocumentEventMap, TrackAction]>

  const cleanups = listeners.map(([eventName, action]) => {
    const listener = (event: Event) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-track-native="true"][data-track],button,input,textarea,select,form,a')
        : null
      if (!target || (target.dataset.slot && target.dataset.trackNative !== "true")) return
      const component = stableDimension(target.dataset.trackComponent) ?? `native-${target.localName}`
      const eventKey = stableEventKey(target.dataset.track) ?? `${component}.${action}`
      track({
        component,
        name: eventKey,
        action,
        eventKey,
      })
    }
    root.addEventListener(eventName, listener, true)
    return () => root.removeEventListener(eventName, listener, true)
  })

  return () => {
    for (const cleanup of cleanups) cleanup()
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

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === "AbortError"
    || error.name === "GitOperationCancelledError"
    || /(?:cancelled|canceled|已取消)/iu.test(error.message)
  )
}
