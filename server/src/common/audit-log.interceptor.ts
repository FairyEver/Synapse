import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common"
import type { Request } from "express"
import { Observable, tap } from "rxjs"
import { AdminAuthService } from "../admin-auth/admin-auth.service"
import type { AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuditLogService } from "./audit-log.service"

const SENSITIVE_BODY_KEY_PATTERN = /password|token|secret|credential/i
const REDACTED_VALUE = "[REDACTED]"
const USER_STATUS_PATH_PATTERN = /^\/api\/admin\/users\/[^/]+\/status$/
const TEAM_ENTITLEMENTS_PATH_PATTERN = /^\/api\/admin\/teams\/[^/]+\/entitlements$/
const TEAM_PERMISSIONS_PATH_PATTERN = /^\/api\/admin\/teams\/[^/]+\/permissions$/

interface AuditPolicy {
  readonly success: boolean
  readonly failure: boolean
}

const noAudit: AuditPolicy = { success: false, failure: false }

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly auditLog: AuditLogService,
    private readonly auth: AdminAuthService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<
      Request & { cookies?: Record<string, string> } & Pick<AdminRequest, "admin">
    >()

    const policy = resolveAuditPolicy(request.method, request.path, Boolean(request.admin?.email))
    if (!policy.success && !policy.failure) {
      return next.handle()
    }

    const path = request.path
    const method = request.method
    const recordAudit = async (responseBody: unknown, error?: unknown) => {
      const { action, targetType, targetId } = resolveAuditTarget(
        method,
        path,
        request.params as Record<string, string>,
        responseBody,
      )
      if (!action) return

      void this.auditLog.record({
        adminEmail: request.admin?.email ?? await this.auth.getEmail(),
        action: error ? `${action}.failed` : action,
        targetType,
        targetId,
        detail: {
          method,
          path,
          body: redactSensitiveBody(request.body),
          ...(error ? { error: formatError(error) } : {}),
        },
        ipAddress: request.ip ?? "",
      })
    }

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          if (policy.success) void recordAudit(responseBody)
        },
        error: (error) => {
          if (policy.failure) void recordAudit(undefined, error)
        },
      }),
    )
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  if (path.startsWith("/api/admin/backup")) {
    const shouldAudit = shouldAuditBackupRequest(method, path)
    return { success: shouldAudit, failure: shouldAudit }
  }
  if (hasAuthenticatedAdmin && path.startsWith("/api/admin/")) {
    return { success: false, failure: true }
  }
  return noAudit
}

function shouldAuditBackupRequest(method: string, path: string): boolean {
  if (method === "POST" && path === "/api/admin/backup") return true
  if (method === "DELETE" && path.startsWith("/api/admin/backup/")) return true
  return method === "GET" && (
    path === "/api/admin/backup/list" ||
    path.startsWith("/api/admin/backup/download/")
  )
}

function resolveAuditTarget(
  method: string,
  path: string,
  params: Record<string, string>,
  responseBody: unknown,
): { action: string; targetType: string; targetId: string } {
  const knownAdminTarget = resolveKnownAdminAuditTarget(method, path, params, responseBody)
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
  responseBody: unknown,
): { action: string; targetType: string; targetId: string } | null {
  if (method === "POST" && path === "/api/admin/invitations") {
    return { action: "admin.invitation.create", targetType: "invitation", targetId: readId(responseBody) }
  }
  if (method === "DELETE" && path === "/api/admin/invitations") {
    return { action: "admin.invitation.delete_many", targetType: "invitation", targetId: readId(responseBody) }
  }
  if (method === "DELETE" && path.startsWith("/api/admin/invitations/")) {
    return { action: "admin.invitation.delete", targetType: "invitation", targetId: params.id ?? readId(responseBody) }
  }
  if (method === "PATCH" && USER_STATUS_PATH_PATTERN.test(path)) {
    return { action: "admin.user.status_update", targetType: "user", targetId: params.id ?? readId(responseBody) }
  }
  if (method === "PUT" && (TEAM_ENTITLEMENTS_PATH_PATTERN.test(path) || TEAM_PERMISSIONS_PATH_PATTERN.test(path))) {
    return { action: "admin.team_entitlements.update", targetType: "team", targetId: params.teamId ?? readId(responseBody) }
  }
  if (method === "GET" && path === "/api/admin/audit-logs/export") {
    return { action: "admin.audit_logs.export", targetType: "audit_log", targetId: "export" }
  }
  if (method === "GET" && path === "/api/admin/logs/download") {
    return { action: "logs.download", targetType: "logs", targetId: readId(responseBody) }
  }
  if (method === "DELETE" && path === "/api/admin/logs/cleanup") {
    return { action: "logs.cleanup", targetType: "logs", targetId: readId(responseBody) }
  }
  return null
}

function readId(body: unknown): string {
  if (body && typeof body === "object" && "id" in body) {
    return String((body as { id: unknown }).id)
  }
  if (body && typeof body === "object" && "filename" in body) {
    return String((body as { filename: unknown }).filename)
  }
  return "unknown"
}
