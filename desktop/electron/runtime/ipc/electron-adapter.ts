/**
 * Phase 0.3 — Electron IPC transport adapter.
 *
 * Wires IpcRegistry into ipcMain.handle for production use.
 * This is the ONLY allowed place outside tests to use ipcMain.handle.
 */

import { ipcMain } from "electron"

type IpcTransportLogger = {
  info?: (message: string, meta?: unknown) => void
  warn?: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type ElectronTransportInstallOptions = {
  logger?: IpcTransportLogger
}

const SENSITIVE_FIELD_PATTERN =
  /(password|token|secret|credential|api[-_]?key|app[-_]?secret|private[-_ ]?key|cookie|authorization)/i
const BODY_FIELD_PATTERN = /^(prompt|message|content)$/
const MAX_STRING_LENGTH = 300
const MAX_STACK_LENGTH = 1200
const MAX_ARRAY_LENGTH = 20

function sanitizeIpcValue(fieldName: string, value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") {
    if (SENSITIVE_FIELD_PATTERN.test(fieldName)) return "[redacted]"
    if (isBodyField(fieldName)) return `[redacted text ${value.length} chars]`
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, 120)}...[truncated ${value.length} chars]`
      : value
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeIpcValue(fieldName, item, depth + 1))
  }
  if (typeof value === "object") {
    if (depth >= 3) return "[object]"
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeIpcValue(key, item, depth + 1),
      ]),
    )
  }
  return String(value)
}

function isBodyField(fieldName: string): boolean {
  return BODY_FIELD_PATTERN.test(fieldName.toLowerCase().replace(/[-_\s]/g, ""))
}

function sanitizeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      messageLength: error.message.length,
      stack: sanitizeErrorStack(error),
    }
  }

  const text = typeof error === "string" ? error : String(error)
  return {
    name: typeof error,
    messageLength: text.length,
  }
}

function sanitizeErrorStack(error: Error): string | undefined {
  if (!error.stack) return undefined
  const [, ...frames] = error.stack.split("\n")
  const stack = [
    `${error.name}: [redacted message ${error.message.length} chars]`,
    ...frames.map(redactDiagnosticText),
  ].join("\n")
  return stack.length > MAX_STACK_LENGTH
    ? `${stack.slice(0, MAX_STACK_LENGTH)}...[truncated ${stack.length} chars]`
    : stack
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/([A-Za-z]:\\[^\s)]+|\/[^\s)]+)/g, "[path redacted]")
    .replace(
      /(password|token|secret|credential|api[-_]?key|app[-_]?secret|private[-_ ]?key|cookie|authorization)(\s*[:=]\s*)([^\s,;&)]+)/gi,
      "$1$2[redacted]",
    )
}

/**
 * Electron transport: installs handlers via ipcMain.handle.
 * Each installed handler returns a disposer that removes the listener.
 */
export function createElectronTransportInstall(options: ElectronTransportInstallOptions = {}) {
  return (channel: string, invoker: (request: unknown) => Promise<unknown>) => {
    // eslint-disable-next-line no-restricted-properties -- This adapter is the single Electron transport boundary for IpcRegistry.
    ipcMain.handle(channel, async (_event, request) => {
      const startedAt = performance.now()
      try {
        return await invoker(request)
      } catch (error) {
        options.logger?.error("IPC invoke failed.", {
          channel,
          durationMs: Math.round(performance.now() - startedAt),
          error: sanitizeErrorForLog(error),
          request: sanitizeIpcValue("request", request),
        })
        throw error
      }
    })
    return () => {
      ipcMain.removeHandler(channel)
    }
  }
}
