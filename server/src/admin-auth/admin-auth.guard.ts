import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from "@nestjs/common"
import type { Request } from "express"
import { PinoLogger } from "nestjs-pino"
import { AuditLogService } from "../common/audit-log.service"
import { recordAuthGuardFailure } from "../common/auth-guard-audit"
import { adminSessionCookieName } from "./admin-auth.controller"
import { AdminAuthService } from "./admin-auth.service"
import { assertTrustedAdminOrigin } from "./admin-origin"

export interface AdminRequest extends Request {
  admin?: {
    readonly sessionId: string
    /** @deprecated Use sessionId for audit correlation. */
    readonly id: string
    /** @deprecated Encoded audit context; this is not an account email. */
    readonly email: string
  }
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>()
    assertTrustedAdminOrigin(request)
    const token = request.cookies?.[adminSessionCookieName]
    const verification = typeof token === "string"
      ? await this.auth.verifySession(token)
      : { status: "invalid" as const }
    if (verification.status !== "active") {
      await this.auth.recordRejectedSession(verification, request.ip ?? "")
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "admin.auth.verify.failed",
        logger: this.logger,
        request,
        tokenPresent: typeof token === "string",
      })
      throw new UnauthorizedException("管理会话无效或已过期。")
    }
    request.admin = {
      sessionId: verification.session.sessionId,
      id: verification.session.sessionId,
      email: `platform_admin:${verification.session.sessionId}`,
    }
    return true
  }
}
