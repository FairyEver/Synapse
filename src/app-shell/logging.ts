import type {
  SynapseLogAppendedEvent,
  SynapseLogExportResult,
  SynapseLogLevel,
  SynapseLogListQuery,
  SynapseLogListResult,
  SynapseLogSummary,
} from "@/types/log"
import { createMissingBridgeError, getSynapseBridge } from "@/lib/electron-bridge"

type RendererLogger = {
  debug: (message: string, details?: unknown) => void
  info: (message: string, details?: unknown) => void
  warn: (message: string, details?: unknown) => void
  error: (message: string, details?: unknown) => void
}

type RendererLogBridge = NonNullable<Window["synapse"]>["log"]

function getLogBridge(): RendererLogBridge | undefined {
  return getSynapseBridge()?.log
}

function hasLogBridge(): boolean {
  return Boolean(getLogBridge())
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
    details,
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
    // eslint-disable-next-line no-console
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

function readLogSummary(): Promise<SynapseLogSummary> {
  const bridge = getLogBridge()

  if (!bridge) {
    return Promise.resolve({ total: 0 })
  }

  return bridge.summary()
}

function readLogList(query: SynapseLogListQuery): Promise<SynapseLogListResult> {
  const bridge = getLogBridge()

  if (!bridge) {
    return Promise.resolve({
      total: 0,
      entries: [],
    })
  }

  return bridge.list(query)
}

function exportLogs(): Promise<SynapseLogExportResult> {
  const bridge = getLogBridge()

  if (!bridge) {
    return Promise.reject(createMissingBridgeError())
  }

  return bridge.export()
}

function subscribeToLogAppends(
  listener: (event: SynapseLogAppendedEvent) => void,
): () => void {
  return getLogBridge()?.onAppended(listener) ?? (() => {})
}

function installRendererLogForwarding(): () => void {
  const logger = createRendererLogger("renderer.runtime")

  const handleError = (event: ErrorEvent) => {
    logger.error(event.message || "Renderer error event.", {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : null,
    })
  }

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    logger.error("Unhandled promise rejection in renderer.", event.reason)
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
  exportLogs,
  hasLogBridge,
  installRendererLogForwarding,
  readLogList,
  readLogSummary,
  subscribeToLogAppends,
}
