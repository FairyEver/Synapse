import type { Request } from "express"
import type { PinoLogger } from "nestjs-pino"
import { formatAuditError } from "./audit-error"
import type { AuditLogService } from "./audit-log.service"

interface AuthGuardFailureAuditInput {
  readonly action: string
  readonly auditLog?: AuditLogService
  readonly logger?: Pick<PinoLogger, "warn">
  readonly request: Pick<Request, "ip" | "method" | "path">
  readonly tokenPresent?: boolean
  /** @deprecated The value is never recorded; callers should pass tokenPresent. */
  readonly token?: string
}

export async function recordAuthGuardFailure(input: AuthGuardFailureAuditInput): Promise<void> {
  try {
    await input.auditLog?.record({
      adminEmail: "unknown",
      action: input.action,
      targetType: "auth",
      targetId: "unknown",
      detail: {
        method: input.request.method,
        path: input.request.path,
        tokenPresent: input.tokenPresent ?? Boolean(input.token),
      },
      ipAddress: input.request.ip ?? "",
    })
  } catch (auditError) {
    input.logger?.warn({
      action: input.action,
      error: formatAuditError(auditError),
      errorName: auditError instanceof Error ? auditError.name : typeof auditError,
      ...(auditError instanceof Error && "code" in auditError && typeof auditError.code === "string"
        ? { errorCode: auditError.code }
        : {}),
      method: input.request.method,
      path: input.request.path,
      tokenPresent: input.tokenPresent ?? Boolean(input.token),
    }, "Failed to record auth guard audit log")
  }
}
