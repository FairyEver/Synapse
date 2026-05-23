import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common"
import type { Request } from "express"
import { Observable, tap } from "rxjs"
import { AdminAuthService } from "../admin-auth/admin-auth.service"
import { AuditLogService } from "./audit-log.service"

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"])
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
      Request & { cookies?: Record<string, string> }
    >()

    if (!WRITE_METHODS.has(request.method)) {
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
          adminEmail: await this.auth.getEmail(),
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

function resolveAuditTarget(
  method: string,
  path: string,
  params: Record<string, string>,
  responseBody: unknown,
): { action: string; targetType: string; targetId: string } {
  const id = params.id ?? readId(responseBody)
  const segments = path.replace("/api/admin/", "").split("/")
  const resource = segments[0] ?? "unknown"

  let action = `${resource}.${method.toLowerCase()}`
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
  return "unknown"
}
