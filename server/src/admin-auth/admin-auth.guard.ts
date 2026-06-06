import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, UnauthorizedException } from "@nestjs/common"
import type { Request } from "express"
import { PinoLogger } from "nestjs-pino"
import { AuditLogService } from "../common/audit-log.service"
import { recordAuthGuardFailure } from "../common/auth-guard-audit"
import { AdminAuthService } from "./admin-auth.service"

export interface AdminRequest extends Request {
  admin?: { id: string; email: string }
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
    const token = request.cookies?.synapse_admin
    const session = typeof token === "string" ? await this.auth.verifyDashboardSession(token) : null
    if (!session) {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "admin.auth.verify.failed",
        logger: this.logger,
        request,
        token,
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    if (session.role !== "admin") {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "admin.auth.forbidden",
        logger: this.logger,
        request,
        token,
      })
      throw new ForbiddenException("需要管理员权限。")
    }
    request.admin = { id: session.id, email: session.email }
    return true
  }
}
