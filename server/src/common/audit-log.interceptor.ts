import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
} from "@nestjs/common"
import type { Request } from "express"
import { PinoLogger } from "nestjs-pino"
import { catchError, from, mergeMap, Observable, throwError } from "rxjs"
import type { AdminRequest } from "../admin-auth/admin-auth.guard"
import { formatAuditError } from "./audit-error"
import { AuditLogService } from "./audit-log.service"

const SENSITIVE_BODY_KEY_PATTERN = /authorization|bearer|cookie|password|token|secret|credential|api[-_]?key|access[-_]?key/i
const REDACTED_VALUE = "[REDACTED]"
const USER_STATUS_PATH_PATTERN = /^\/api\/admin\/users\/[^/]+\/status$/
const ADMIN_WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const PROBLEM_FEEDBACK_ADMIN_PATH_PATTERN =
  /^\/api\/admin\/problem-feedback(?:\/[^/]+)?$/u

interface AuditPolicy {
  readonly success: boolean
  readonly failure: boolean
}

const noAudit: AuditPolicy = { success: false, failure: false }

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly auditLog: AuditLogService,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<
      Request & { cookies?: Record<string, string> } & Pick<AdminRequest, "admin">
    >()

    const adminSessionId = request.admin?.sessionId ?? request.admin?.id
    const policy = resolveAuditPolicy(request.method, request.path, Boolean(adminSessionId))
    if (!policy.success && !policy.failure) {
      return next.handle()
    }

    const path = request.path
    const method = request.method
    const query = request.query as Record<string, unknown>
    const recordAudit = async (responseBody: unknown, error?: unknown) => {
      const { action, targetType, targetId } = resolveAuditTarget(
        method,
        path,
        request.params as Record<string, string>,
        query,
        error ?? responseBody,
      )
      if (!action) return

      const auditAction = error ? `${action}.failed` : action
      try {
        await this.auditLog.record({
          adminEmail: request.admin?.email ?? "unauthenticated",
          action: auditAction,
          targetType,
          targetId,
          detail: {
            method,
            path,
            body: redactSensitiveBody(request.body),
            ...(error ? { error: formatAuditError(error) } : {}),
          },
          ipAddress: request.ip ?? "",
        })
      } catch (auditError) {
        this.logger?.warn({
          err: auditError,
          action: auditAction,
          targetType,
          targetId,
          originalErrorName: error instanceof Error ? error.name : typeof error,
          originalErrorLength: error instanceof Error ? error.message.length : error ? String(error).length : 0,
        }, "Failed to record audit log from interceptor")
      }
    }

    return next.handle().pipe(
      mergeMap(async (responseBody) => {
        if (policy.success) await recordAudit(responseBody)
        return responseBody
      }),
      catchError((error) => {
        if (!policy.failure) return throwError(() => error)
        return from(recordAudit(undefined, error)).pipe(
          mergeMap(() => throwError(() => error)),
        )
      }),
    )
  }
}

function redactSensitiveBody(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveBody)
  if (!value || typeof value !== "object") return value

  const result: Record<string, unknown> = {}
  for (const [key, childValue] of Object.entries(value)) {
    result[key] = SENSITIVE_BODY_KEY_PATTERN.test(key) ? REDACTED_VALUE : redactSensitiveBody(childValue)
  }
  return result
}

function resolveAuditPolicy(method: string, path: string, hasAuthenticatedAdmin: boolean): AuditPolicy {
  if (PROBLEM_FEEDBACK_ADMIN_PATH_PATTERN.test(path)) return noAudit
  if (path.startsWith("/api/admin/backup")) {
    const shouldAudit = shouldAuditBackupRequest(method, path)
    return { success: shouldAudit, failure: shouldAudit }
  }
  if (hasAuthenticatedAdmin && path.startsWith("/api/admin/")) {
    return { success: shouldAuditAdminSuccessFallback(method, path), failure: true }
  }
  return noAudit
}

function shouldAuditBackupRequest(method: string, path: string): boolean {
  if (method === "POST" && path === "/api/admin/backup") return true
  if (method === "DELETE" && path.startsWith("/api/admin/backup/")) return true
  return method === "GET" && path === "/api/admin/backup/list"
}

function shouldAuditAdminSuccessFallback(method: string, path: string): boolean {
  if (!ADMIN_WRITE_METHODS.has(method)) return false
  return !hasControllerManagedAdminSuccessAudit(method, path)
}

function hasControllerManagedAdminSuccessAudit(method: string, path: string): boolean {
  if (method === "PATCH" && USER_STATUS_PATH_PATTERN.test(path)) return true
  return method === "DELETE" && path === "/api/admin/logs/cleanup"
}

function resolveAuditTarget(
  method: string,
  path: string,
  params: Record<string, string>,
  query: Record<string, unknown>,
  responseBody: unknown,
): { action: string; targetType: string; targetId: string } {
  const knownAdminTarget = resolveKnownAdminAuditTarget(method, path, params, query, responseBody)
  if (knownAdminTarget) return knownAdminTarget

  const id = params.id ?? params.filename ?? readId(responseBody)
  const segments = path.replace("/api/admin/", "").split("/")
  const resource = segments[0] ?? "unknown"

  let action = `${resource}.${method.toLowerCase()}`
  if (resource === "backup" && segments.includes("list")) action = "backup.list"
  if (resource === "backup" && segments.includes("download")) action = "backup.download"

  return { action, targetType: resource, targetId: id }
}

function resolveKnownAdminAuditTarget(
  method: string,
  path: string,
  params: Record<string, string>,
  query: Record<string, unknown>,
  responseBody: unknown,
): { action: string; targetType: string; targetId: string } | null {
  if (method === "PATCH" && USER_STATUS_PATH_PATTERN.test(path)) {
    return { action: "admin.user.status_update", targetType: "user", targetId: params.id ?? readId(responseBody) }
  }
  if (method === "GET" && path === "/api/admin/backup/list") {
    return { action: "backup.list", targetType: "backup", targetId: "list" }
  }
  if (method === "GET" && path === "/api/admin/audit-logs/export") {
    return { action: "admin.audit_logs.export", targetType: "audit_log", targetId: "export" }
  }
  if (method === "GET" && path === "/api/admin/logs/files") {
    return { action: "logs.list_files", targetType: "logs", targetId: "files" }
  }
  if (method === "GET" && path === "/api/admin/logs/recent") {
    return { action: "logs.recent", targetType: "logs", targetId: "recent" }
  }
  if (method === "GET" && path === "/api/admin/logs/download") {
    return { action: "logs.download", targetType: "logs", targetId: readLogDownloadTarget(query, responseBody) }
  }
  if (method === "DELETE" && path === "/api/admin/logs/cleanup") {
    return { action: "logs.cleanup", targetType: "logs", targetId: readQueryString(query, "before") ?? readId(responseBody) }
  }
  return null
}

function readLogDownloadTarget(query: Record<string, unknown>, responseBody: unknown): string {
  const bodyId = readId(responseBody)
  if (bodyId !== "unknown") return bodyId
  const from = readQueryString(query, "from")
  const to = readQueryString(query, "to")
  return from || to
    ? `logs-${from ?? "start"}-${to ?? "now"}.zip`
    : "logs-all.zip"
}

function readQueryString(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key]
  if (typeof value === "string" && value.trim()) return value
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === "string" && item.trim().length > 0)
    return first
  }
  return undefined
}

function readId(body: unknown): string {
  if (body && typeof body === "object" && "id" in body) {
    return String((body as { id: unknown }).id)
  }
  if (body && typeof body === "object" && "filename" in body) return String((body as { filename: unknown }).filename)
  return "unknown"
}
