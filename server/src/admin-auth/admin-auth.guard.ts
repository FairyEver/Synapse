import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common"
import type { Request } from "express"
import { AdminAuthService } from "./admin-auth.service"

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & {
      cookies?: Record<string, string>
    }>()
    const token = request.cookies?.synapse_admin
    const allowed = typeof token === "string" && this.auth.verify(token)
    if (!allowed) {
      throw new ForbiddenException("未登录或登录已过期。")
    }
    return true
  }
}
