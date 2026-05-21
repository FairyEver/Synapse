import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common"
import type { Request } from "express"
import { UserAuthService } from "./user-auth.service"

export interface AuthenticatedUserRequest extends Request {
  user?: { id: string }
}

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(private readonly auth: UserAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedUserRequest>()
    const header = request.headers.authorization
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    const result = await this.auth.verifyAccessToken(header.slice("Bearer ".length))
    request.user = { id: result.userId }
    return true
  }
}
