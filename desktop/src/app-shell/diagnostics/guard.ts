import type { RendererLogger } from "./types"

let _writing = false
const pendingLogs: Array<{
  logger: RendererLogger
  level: "debug" | "info" | "warn" | "error"
  message: string
  meta?: unknown
}> = []

export function guardedLog(
  logger: RendererLogger,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: unknown,
): void {
  if (_writing) {
    pendingLogs.push({ logger, level, message, meta })
    return
  }

  _writing = true
  let next: (typeof pendingLogs)[number] | undefined = { logger, level, message, meta }

  while (next) {
    try {
      next.logger[next.level](next.message, next.meta)
    } catch {
      // Logging must never break the app
    }
    next = pendingLogs.shift()
  }

  _writing = false
}
