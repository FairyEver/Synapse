export const LOG_CLEANUP_RETENTION_DAYS = 30
const CLEANUP_RETENTION_MS = LOG_CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1000

export function getCleanupBeforeDate(now = Date.now()) {
  return new Date(now - CLEANUP_RETENTION_MS)
}
