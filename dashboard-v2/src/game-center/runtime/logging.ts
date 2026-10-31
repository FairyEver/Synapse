/** Asset/device failures are structured and never include private game data or raw errors. */
export function createRendererLogger(category: string) {
  return {
    warn(message: string, details?: unknown) {
      const error = details && typeof details === "object" && "error" in details ? details.error : undefined
      console.warn({ category, message, errorName: error instanceof Error ? error.name : undefined })
    },
  }
}
