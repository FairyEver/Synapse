import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

export function installGlobalErrorListener(logger: RendererLogger): () => void {
  const handleError = (event: ErrorEvent) => {
    guardedLog(logger, "error", event.message || "Uncaught error", {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack,
    })
  }

  const handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection"
    const stack = reason instanceof Error ? reason.stack : undefined
    guardedLog(logger, "error", message, { type: "unhandledrejection", stack })
  }

  window.addEventListener("error", handleError)
  window.addEventListener("unhandledrejection", handleRejection)

  return () => {
    window.removeEventListener("error", handleError)
    window.removeEventListener("unhandledrejection", handleRejection)
  }
}
