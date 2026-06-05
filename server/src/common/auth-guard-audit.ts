import type { Request } from "express"
import type { AuditLogService } from "./audit-log.service"

interface AuthGuardFailureAuditInput {
  readonly action: string
  readonly auditLog?: AuditLogService
  readonly request: Pick<Request, "ip" | "method" | "path">
  readonly token?: string
}

export async function recordAuthGuardFailure(input: AuthGuardFailureAuditInput): Promise<void> {
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
}
