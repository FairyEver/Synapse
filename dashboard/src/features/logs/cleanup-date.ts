const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function getCleanupBeforeDate(now = Date.now()): string {
  return new Date(now - CLEANUP_RETENTION_MS).toISOString().slice(0, 10)
}
