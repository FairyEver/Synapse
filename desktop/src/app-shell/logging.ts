import type { SynapseLogLevel } from "@/types/log"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { getDiagnosticSnapshot } from "@/lib/diagnostic-context"

type RendererLogger = {
  debug: (message: string, details?: unknown) => void
  info: (message: string, details?: unknown) => void
  warn: (message: string, details?: unknown) => void
  error: (message: string, details?: unknown) => void
}

type RendererLogBridge = NonNullable<Window["synapse"]>["log"]

const SENSITIVE_LOG_FIELD_PATTERN =
  /(password|token|secret|credential|api[-_]?key|app[-_]?secret|private[-_ ]?key|cookie|authorization|session[-_]?key|session[-_]?id|install[-_]?session[-_]?id|skill[-_]?repository[-_]?install[-_]?session[-_]?id)/i
const CONTENT_LOG_FIELD_PATTERN = /^(details|prompt|message|content|body|text|reason|error|errors|stack)$/i
const PATH_LOG_FIELD_PATTERN =
  /(^|[-_ ])(path|dir|directory|folder|file)([-_ ]|$)|(^|[-_ ])file[-_ ]?name([-_ ]|$)|(base|source|target|export|workspace)[-_ ]?(dir|directory|folder|path)/i
const POSIX_ABSOLUTE_LOG_PATH_PATTERN = /^(?:file:\/\/)?\/(?:[^/\s"')]+\/)+[^/\s"'),;]+$/
const WINDOWS_ABSOLUTE_LOG_PATH_PATTERN = /^(?:file:\/\/\/)?[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+$/

function getLogBridge(): RendererLogBridge | undefined {
  return getSynapseBridge()?.log
}

async function writeRendererLog(
  level: SynapseLogLevel,
  category: string,
  message: string,
  details?: unknown,
): Promise<void> {
  const bridge = getLogBridge()

  if (!bridge) {
    return
  }

  await bridge.write({
    level,
    category,
    message,
    details: sanitizeRendererLogDetails("details", details),
  })
}

function emitRendererLog(
  level: SynapseLogLevel,
  category: string,
  message: string,
  details?: unknown,
): void {
  // Logging failures must not break the user flow or create an unsanitized fallback log.
  void writeRendererLog(level, category, message, details).catch((err) => {
    console.warn(`[${category}] renderer log write failed.`, sanitizeRendererLogDetails("error", err))
  })
}

function createRendererLogger(category: string): RendererLogger {
  return {
    debug: (message, details) => emitRendererLog("debug", category, message, details),
    info: (message, details) => emitRendererLog("info", category, message, details),
    warn: (message, details) => emitRendererLog("warn", category, message, details),
    error: (message, details) => emitRendererLog("error", category, message, details),
  }
}

function sanitizeRendererLogDetails(fieldName: string, value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return value
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") {
    if (SENSITIVE_LOG_FIELD_PATTERN.test(fieldName)) return "[redacted]"
    if (CONTENT_LOG_FIELD_PATTERN.test(fieldName)) return { [`${fieldName}Length`]: value.length }
    if (PATH_LOG_FIELD_PATTERN.test(fieldName) || looksAbsoluteLogPath(value)) return redactLogPath(value)
    return value.length > 120 ? `${value.slice(0, 120)}...[truncated ${value.length} chars]` : value
  }
  if (value instanceof Error) {
    return {
      errorName: value.name,
      messageLength: value.message.length,
      stackLength: value.stack?.length,
    }
  }
  if (Array.isArray(value)) {
    if (depth >= 3) return "[array]"
    return value.slice(0, 20).map((item) => sanitizeRendererLogDetails(fieldName, item, depth + 1))
  }
  if (typeof value === "object") {
    if (depth >= 3) return "[object]"
    const sanitizedEntries: Array<[string, unknown]> = []
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_LOG_FIELD_PATTERN.test(key)) {
        sanitizedEntries.push([key, "[redacted]"])
        continue
      }
      if (CONTENT_LOG_FIELD_PATTERN.test(key) && typeof item === "string") {
        sanitizedEntries.push([`${key}Length`, item.length])
        continue
      }
      sanitizedEntries.push([key, sanitizeRendererLogDetails(key, item, depth + 1)])
    }
    return Object.fromEntries(sanitizedEntries)
  }
  return String(value)
}

function looksAbsoluteLogPath(value: string): boolean {
  return POSIX_ABSOLUTE_LOG_PATH_PATTERN.test(value)
    || WINDOWS_ABSOLUTE_LOG_PATH_PATTERN.test(value)
}

function redactLogPath(value: string): string {
  if (!value.trim()) return ""
  const withoutFileProtocol = value.replace(/^file:\/\/\/?/, "/")
  const normalized = withoutFileProtocol.replace(/\\/g, "/")
  const basename = normalized.split("/").filter(Boolean).at(-1)
  return basename ? `[path redacted]/${basename}` : "[path redacted]"
}

function installRendererLogForwarding(): () => void {
  const logger = createRendererLogger("renderer.runtime")

  const handleError = (event: ErrorEvent) => {
    logger.error(event.message || "Renderer error event.", {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : null,
      diagnostics: getDiagnosticSnapshot(),
    })
  }

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    logger.error("Unhandled promise rejection in renderer.", {
      reason: event.reason,
      diagnostics: getDiagnosticSnapshot(),
    })
  }

  window.addEventListener("error", handleError)
  window.addEventListener("unhandledrejection", handleUnhandledRejection)

  return () => {
    window.removeEventListener("error", handleError)
    window.removeEventListener("unhandledrejection", handleUnhandledRejection)
  }
}

export {
  createRendererLogger,
  installRendererLogForwarding,
}
