import { ExecutionContext, Inject, Injectable, Logger, Optional } from "@nestjs/common"
import { GUARDS_METADATA } from "@nestjs/common/constants"
import { Reflector } from "@nestjs/core"
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from "@nestjs/throttler"
import { isTrustedCookieOrigin } from "../auth/cookie-origin"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { UserAuthService } from "../auth/user-auth.service"
import { userSessionCookieName } from "../auth/user-web-session"

function readBearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(/\s+/, 2) ?? []
  if (scheme?.toLowerCase() !== "bearer" || !token) return null
  return token
}

/**
 * 全局 API 限流守卫：
 * - 对挂有 `UserAuthGuard` 的认证路由，优先按已验签/已校验的用户账号 (`user:<id>`) 独立计数，
 *   避免公司 NAT 等共享公网出口 IP 下单个用户的高频操作波及同出口其他同事；
 * - 未携带有效凭据，或公开/匿名路由（如登录、注册、公开分享等），保持按客户端 IP (`ip:<addr>`) 计数。
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(AppThrottlerGuard.name)

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
    @Optional() @Inject(UserAuthService) private readonly userAuth?: UserAuthService,
  ) {
    super(options, storageService, reflector)
  }

  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const hasCustomTracker = requestProps.getTracker !== this.commonOptions.getTracker
    if (hasCustomTracker || !this.usesUserAuthGuard(requestProps.context)) {
      return super.handleRequest(requestProps)
    }
    return super.handleRequest({
      ...requestProps,
      getTracker: (req) => this.resolveUserOrIpTracker(req as AuthenticatedUserRequest),
    })
  }

  private usesUserAuthGuard(context: ExecutionContext): boolean {
    const guards = this.reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ])
    return Array.isArray(guards) && guards.some((guard) => guard === UserAuthGuard || guard instanceof UserAuthGuard)
  }

  private async resolveUserOrIpTracker(request: AuthenticatedUserRequest): Promise<string> {
    if (request.user?.id) return `user:${request.user.id}`

    const bearerToken = readBearerToken(request.headers.authorization)
    if (bearerToken) {
      const userId = this.userAuth?.resolveAccessTokenSubject(bearerToken) ?? null
      if (userId) return `user:${userId}`
      return `ip:${(await super.getTracker(request)) ?? "unknown"}`
    }

    const cookieToken = request.cookies?.[userSessionCookieName]
    if (
      typeof cookieToken === "string"
      && cookieToken.length > 0
      && this.userAuth
      && isTrustedCookieOrigin(request, process.env.APP_PUBLIC_URL)
    ) {
      try {
        const userId = await this.userAuth.resolveWebSessionUserId(cookieToken)
        if (userId) return `user:${userId}`
      } catch (error) {
        const errorName = error instanceof Error ? error.name : typeof error
        this.logger.warn(`Failed to resolve web session user for throttling (${errorName}); falling back to IP tracker.`)
      }
    }

    return `ip:${(await super.getTracker(request)) ?? "unknown"}`
  }
}
