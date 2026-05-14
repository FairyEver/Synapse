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
  /(password|token|secret|credential|api[-_]?key|app[-_]?secret|private[-_ ]?key|cookie|authorization)/i
const CONTENT_LOG_FIELD_PATTERN = /^(details|prompt|message|content|body|text|reason|stack)$/i

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

  bridge.write({
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
  void writeRendererLog(level, category, message, details).catch((error) => {
    // Logging should never break the user flow, but we log to console in development.
    console.error("Failed to write renderer log.", { level, category, message, error })
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
