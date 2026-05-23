import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from "@nestjs/common"
import type { Request } from "express"
import { AuditLogService } from "../common/audit-log.service"
import { recordAuthGuardFailure } from "../common/auth-guard-audit"
import { UserAuthService } from "./user-auth.service"

export interface AuthenticatedUserRequest extends Request {
  user?: { id: string }
}

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly auth: UserAuthService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedUserRequest>()
    const header = request.headers.authorization
    if (!header?.startsWith("Bearer ")) {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "user.auth.verify.failed",
        request,
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    const token = header.slice("Bearer ".length)
    const result = await this.verifyAccessToken(request, token)
    request.user = { id: result.userId }
    return true
  }

  private async verifyAccessToken(request: AuthenticatedUserRequest, token: string): Promise<{ userId: string }> {
    try {
      return await this.auth.verifyAccessToken(token)
    } catch (error) {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "user.auth.verify.failed",
        request,
        token,
      })
      throw error
    }
  }
}
