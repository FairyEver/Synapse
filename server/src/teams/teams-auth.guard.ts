import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common"
import type { Request } from "express"
import { AdminAuthService } from "../admin-auth/admin-auth.service"
import { UserAuthService } from "../auth/user-auth.service"

export interface AuthenticatedTeamRequest extends Request {
  user?: { id: string }
}

@Injectable()
export class TeamsAuthGuard implements CanActivate {
  constructor(
    private readonly userAuth: UserAuthService,
    private readonly dashboardAuth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedTeamRequest>()
    const header = request.headers.authorization
    if (header?.startsWith("Bearer ")) {
      const result = await this.userAuth.verifyAccessToken(header.slice("Bearer ".length))
      request.user = { id: result.userId }
      return true
    }

    const cookieToken = request.cookies?.synapse_admin
    const session = typeof cookieToken === "string"
      ? await this.dashboardAuth.verifyDashboardSession(cookieToken)
      : null
    if (session?.role !== "user") {
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    request.user = { id: session.id }
    return true
  }
}
