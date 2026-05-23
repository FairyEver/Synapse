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

    if (!shouldAuditRequest(request.method, request.path)) {
      return next.handle()
    }

    const path = request.path
    const method = request.method

    return next.handle().pipe(
      tap(async (responseBody) => {
        const { action, targetType, targetId } = resolveAuditTarget(
          method,
          path,
          request.params as Record<string, string>,
          responseBody,
        )
        if (!action) return

        void this.auditLog.record({
          adminEmail: request.admin?.email ?? await this.auth.getEmail(),
          action,
          targetType,
          targetId,
          detail: { method, path, body: redactSensitiveBody(request.body) },
          ipAddress: request.ip ?? "",
        })
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

function shouldAuditRequest(method: string, path: string): boolean {
  if (path.startsWith("/api/admin/backup")) return shouldAuditBackupRequest(method, path)
  return false
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
  const id = params.id ?? params.filename ?? readId(responseBody)
  const segments = path.replace("/api/admin/", "").split("/")
  const resource = segments[0] ?? "unknown"

  let action = `${resource}.${method.toLowerCase()}`
  if (resource === "backup" && segments.includes("list")) action = "backup.list"
  if (resource === "backup" && segments.includes("download")) action = "backup.download"
  if (segments.includes("archive")) action = `${resource}.archive`
  if (segments.includes("risk-lock")) action = `${resource}.risk-lock`
  if (segments.includes("replace")) action = `${resource}.replace`
  if (segments.includes("status")) action = `${resource}.status`

  return { action, targetType: resource, targetId: id }
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
