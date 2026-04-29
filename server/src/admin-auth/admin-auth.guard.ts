import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common"
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
    return typeof token === "string" && this.auth.verify(token)
  }
}
