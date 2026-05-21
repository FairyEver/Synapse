import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common"
import type { Request } from "express"
import { AdminAuthService } from "./admin-auth.service"

export interface AdminRequest extends Request {
  admin?: { id: string; email: string }
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>()
    const token = request.cookies?.synapse_admin
    const admin = typeof token === "string" ? await this.auth.verify(token) : null
    if (!admin) {
      throw new ForbiddenException("未登录或登录已过期。")
    }
    request.admin = admin
    return true
  }
}
