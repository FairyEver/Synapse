import { Inject, Injectable, UnauthorizedException } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { InjectThrottlerStorage, ThrottlerGuard, type ThrottlerStorage } from "@nestjs/throttler"
import type { AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { RATE_LIMIT_TTL_MS } from "../common/rate-limits"

@Injectable()
export class ProfileAvatarRandomThrottleGuard extends ThrottlerGuard {
  constructor(@InjectThrottlerStorage() storage: ThrottlerStorage, @Inject(Reflector) reflector: Reflector) {
    // 独立名称避开此路由的 default 跳过标记；在 UserAuthGuard 之后按账号计数。
    super([{ name: "avatar-random", ttl: RATE_LIMIT_TTL_MS, limit: 60 }], storage, reflector)
  }

  protected async getTracker(request: AuthenticatedUserRequest): Promise<string> {
    if (!request.user) throw new UnauthorizedException("未登录或登录已过期。")
    return request.user.id
  }
}
