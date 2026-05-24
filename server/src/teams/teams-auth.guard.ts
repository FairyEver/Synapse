import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from "@nestjs/common"
import type { Request } from "express"
import { AdminAuthService } from "../admin-auth/admin-auth.service"
import { UserAuthService } from "../auth/user-auth.service"
import { AuditLogService } from "../common/audit-log.service"
import { recordAuthGuardFailure } from "../common/auth-guard-audit"

export interface AuthenticatedTeamRequest extends Request {
  user?: { id: string }
}

@Injectable()
export class TeamsAuthGuard implements CanActivate {
  constructor(
    private readonly userAuth: UserAuthService,
    private readonly dashboardAuth: AdminAuthService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedTeamRequest>()
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
        action: "teams.auth.verify.failed",
        request,
        token: cookieToken,
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    request.user = { id: session.id }
    return true
  }

  private async verifyAccessToken(request: AuthenticatedTeamRequest, token: string): Promise<{ userId: string }> {
    try {
      return await this.userAuth.verifyAccessToken(token)
    } catch (error) {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "teams.auth.verify.failed",
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
