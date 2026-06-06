import type { Request } from "express"
import type { PinoLogger } from "nestjs-pino"
import type { AuditLogService } from "./audit-log.service"

interface AuthGuardFailureAuditInput {
  readonly action: string
  readonly auditLog?: AuditLogService
  readonly logger?: Pick<PinoLogger, "warn">
  readonly request: Pick<Request, "ip" | "method" | "path">
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
        tokenPresent: Boolean(input.token),
      },
      ipAddress: input.request.ip ?? "",
    })
  } catch (auditError) {
    input.logger?.warn({
      err: auditError,
      action: input.action,
      method: input.request.method,
      path: input.request.path,
      tokenPresent: Boolean(input.token),
    }, "Failed to record auth guard audit log")
  }
}
