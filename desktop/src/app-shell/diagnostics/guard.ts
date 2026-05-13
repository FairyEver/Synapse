import type { RendererLogger } from "./types"

let _writing = false

export function guardedLog(
  logger: RendererLogger,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: unknown,
): void {
  if (_writing) return
  _writing = true
  try {
    logger[level](message, meta)
  } catch {
    // Logging must never break the app
  } finally {
    _writing = false
  }
}
