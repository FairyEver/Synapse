import { CanActivate, ExecutionContext, Injectable, Optional, UnauthorizedException } from "@nestjs/common"
import { SKILL_HUB_WEB_SESSION_HEADER } from "@synapse/shared/skill-hub-contracts"
import type { Request } from "express"
import type { Prisma } from "@prisma/client"
import { PinoLogger } from "nestjs-pino"
import { AuditLogService } from "../common/audit-log.service"
import { recordAuthGuardFailure } from "../common/auth-guard-audit"
import { UserAuthService } from "./user-auth.service"
import { hubLogPath } from "../skill-hub/skill-hub-log"
import { userSessionCookieName } from "./user-web-session"
import { assertTunnelCookieOrigin } from "./tunnel-origin"

export interface AuthenticatedUserRequest extends Request {
  user?: { id: string }
  userAuthMethod?: "bearer" | "cookie"
}

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly auth: UserAuthService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext, client?: Prisma.TransactionClient, auditPath?: string): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedUserRequest>()
    const auditRequest = { ip: request.ip, method: request.method, path: auditPath ?? hubLogPath(request.path) ?? request.path }
    const header = request.headers.authorization
    const bearerToken = readBearerToken(header)
    if (bearerToken) {
      const token = bearerToken
      const result = await this.verifyAccessToken(auditRequest, token, client)
      request.user = { id: result.userId }
      request.userAuthMethod = "bearer"
      return true
    }

    const cookieToken = request.cookies?.[userSessionCookieName]
    const session = typeof cookieToken === "string"
      ? await (client ? this.auth.verifyWebSession(cookieToken, client) : this.auth.verifyWebSession(cookieToken))
      : null
    if (!session) {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "user.auth.verify.failed",
        logger: this.logger,
        request: auditRequest,
        tokenPresent: typeof cookieToken === "string",
        client,
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    // A Console tab may still hold the previous session while its shared cookie has changed.
    const expectedHubSession = request.headers[SKILL_HUB_WEB_SESSION_HEADER.toLowerCase()]
    if (hubLogPath(request.path)?.startsWith("/api/skill-hub") && expectedHubSession !== undefined
      && expectedHubSession !== session.sessionId) {
      throw new UnauthorizedException({ code: "HUB_ACCOUNT_CHANGED", message: "登录会话已变化，请刷新页面。" })
    }
    request.user = { id: session.userId }
    request.userAuthMethod = "cookie"
    assertTunnelCookieOrigin(request, process.env.APP_PUBLIC_URL, process.env.TUNNEL_ENABLED === "true")
    return true
  }

  private async verifyAccessToken(request: Pick<Request, "ip" | "method" | "path">, token: string, client?: Prisma.TransactionClient): Promise<{ userId: string }> {
    try {
      return await (client ? this.auth.verifyAccessToken(token, client) : this.auth.verifyAccessToken(token))
    } catch (error) {
      await recordAuthGuardFailure({
        auditLog: this.auditLog,
        action: "user.auth.verify.failed",
        logger: this.logger,
        request,
        tokenPresent: true,
        client,
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
