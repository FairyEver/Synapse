import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"
import { getDiagnosticSnapshot } from "@/lib/diagnostic-context"

export function installGlobalErrorListener(logger: RendererLogger): () => void {
  const handleError = (event: ErrorEvent) => {
    guardedLog(logger, "error", event.message || "Uncaught error", {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack,
      diagnostics: getDiagnosticSnapshot(),
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
    guardedLog(logger, "error", message, {
      type: "unhandledrejection",
      stack,
      diagnostics: getDiagnosticSnapshot(),
    })
  }

  window.addEventListener("error", handleError)
  window.addEventListener("unhandledrejection", handleRejection)

  return () => {
    window.removeEventListener("error", handleError)
    window.removeEventListener("unhandledrejection", handleRejection)
  }
}
