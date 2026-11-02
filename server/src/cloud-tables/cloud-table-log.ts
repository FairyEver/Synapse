import { CLOUD_TABLE_BASE } from "./cloud-table-contract"
import { isCloudTableOpenPath, isCloudTablePath } from "./cloud-table-http"

/** Explicit errors inherit the Pino request child logger even when access logging is disabled. */
export function cloudTableLogRequest(request: Record<string, unknown>): Record<string, unknown> | null {
  const candidate = request.originalUrl ?? request.url
  const raw = request.raw && typeof request.raw === "object" ? request.raw as Record<string, unknown> : undefined
  const path = typeof raw?.path === "string" ? raw.path : typeof request.path === "string" ? request.path : candidate
  if (typeof path !== "string" || !isCloudTablePath(path)) return null
  return { method: request.method, url: isCloudTableOpenPath(path) ? CLOUD_TABLE_BASE : "/api/console/tables" }
}
