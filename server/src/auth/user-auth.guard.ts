import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from "@nestjs/common"
import type { Request } from "express"
import { PinoLogger } from "nestjs-pino"
import { AuditLogService } from "../common/audit-log.service"
import { recordAuthGuardFailure } from "../common/auth-guard-audit"
import { UserAuthService } from "./user-auth.service"
import { userSessionCookieName } from "./user-web-session"

export interface AuthenticatedUserRequest extends Request {
  user?: { id: string }
}

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly auth: UserAuthService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly logger?: PinoLogger,
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

    const cookieToken = request.cookies?.[userSessionCookieName]
    const session = typeof cookieToken === "string"
      ? await this.auth.verifyWebSession(cookieToken)
      : null
    if (!session) {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "user.auth.verify.failed",
        logger: this.logger,
        request,
        tokenPresent: typeof cookieToken === "string",
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    request.user = { id: session.userId }
    return true
  }

  private async verifyAccessToken(request: AuthenticatedUserRequest, token: string): Promise<{ userId: string }> {
    try {
      return await this.auth.verifyAccessToken(token)
    } catch (error) {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "user.auth.verify.failed",
        logger: this.logger,
        request,
        tokenPresent: true,
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
