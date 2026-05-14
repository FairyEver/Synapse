import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"
import { getDiagnosticSnapshot } from "@/lib/diagnostic-context"

export function installGlobalErrorListener(logger: RendererLogger): () => void {
  const handleError = (event: ErrorEvent) => {
    const diagnostic = errorDiagnostic(event.error, event.message)
    guardedLog(logger, "error", "Renderer uncaught error.", {
      boundary: "renderer.global-error",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      ...diagnostic,
      diagnostics: getDiagnosticSnapshot(),
    })
  }

  const handleRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason
    guardedLog(logger, "error", "Renderer unhandled promise rejection.", {
      boundary: "renderer.global-error",
      type: "unhandledrejection",
      reasonType: reason instanceof Error ? reason.name : typeof reason,
      ...errorDiagnostic(reason),
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

function errorDiagnostic(
  error: unknown,
  fallbackMessage = "",
): { errorName: string; errorLength: number; stackLength?: number } {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorLength: error.message.length,
      stackLength: error.stack?.length,
    }
  }

  const message = typeof error === "string" ? error : fallbackMessage
  return {
    errorName: error === undefined || error === null ? "unknown" : typeof error,
    errorLength: message.length,
  }
}
