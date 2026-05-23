import type { Request } from "express"
import type { AuditLogService } from "./audit-log.service"

interface AuthGuardFailureAuditInput {
  readonly action: string
  readonly auditLog?: AuditLogService
  readonly request: Pick<Request, "ip" | "method" | "path">
  readonly token?: string
}

interface JwtAuditClaims {
  readonly email?: string
  readonly sub?: string
  readonly type?: string
}

export async function recordAuthGuardFailure(input: AuthGuardFailureAuditInput): Promise<void> {
  const claims = readJwtClaims(input.token)
  await input.auditLog?.record({
    adminEmail: claims.email ?? "unknown",
    action: input.action,
    targetType: "auth",
    targetId: claims.sub ?? "unknown",
    detail: {
      method: input.request.method,
      path: input.request.path,
      tokenPresent: Boolean(input.token),
      ...(claims.type ? { tokenType: claims.type } : {}),
    },
    ipAddress: input.request.ip ?? "",
  })
}

function readJwtClaims(token: string | undefined): JwtAuditClaims {
  if (!token) return {}
  const [, payload] = token.split(".")
  if (!payload) return {}
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
    return {
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      sub: typeof parsed.sub === "string" ? parsed.sub : undefined,
      type: typeof parsed.type === "string" ? parsed.type : undefined,
    }
  } catch (_error) {
    return {}
  }
}
