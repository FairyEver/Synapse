import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from "@nestjs/common"
import type { Request } from "express"
import { AdminAuthService } from "../admin-auth/admin-auth.service"
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
    private readonly dashboardAuth: AdminAuthService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedUserRequest>()
    const header = request.headers.authorization
    const bearerToken = readBearerToken(header)
    if (bearerToken) {
      const token = bearerToken
      const result = await this.verifyAccessToken(request, token)
      request.user = { id: result.userId }
      return true
    }

    const cookieToken = request.cookies?.synapse_admin
    const session = typeof cookieToken === "string"
      ? await this.dashboardAuth.verifyDashboardSession(cookieToken)
      : null
    if (session?.role !== "user") {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "user.auth.verify.failed",
        request,
        token: cookieToken,
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    request.user = { id: session.id }
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

function readBearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(/\s+/, 2) ?? []
  if (scheme?.toLowerCase() !== "bearer" || !token) return null
  return token
}
