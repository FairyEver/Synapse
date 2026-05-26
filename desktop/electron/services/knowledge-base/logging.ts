import { sanitizeError } from "../error-sanitize"
import { createMainLogger } from "../log-store"

export const knowledgeBaseLogger = createMainLogger("service.knowledge-base")

export function knowledgeBaseErrorMeta(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  return {
    error: sanitizeError(message),
    errorName: error instanceof Error ? error.name : typeof error,
  }
}
