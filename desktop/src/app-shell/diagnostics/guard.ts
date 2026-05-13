import type { RendererLogger } from "./types"

export function guardedLog(
  logger: RendererLogger,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: unknown,
): void {
  try {
    if (meta !== undefined) {
      logger[level](message, meta)
    } else {
      logger[level](message)
    }
  } catch {
    // Swallow errors from the logger itself to avoid infinite loops
  }
}
