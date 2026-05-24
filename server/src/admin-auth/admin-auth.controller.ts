import { BadRequestException, Body, Controller, ForbiddenException, Get, Optional, Post, Req, Res, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Response } from "express"
import { z } from "zod"
import { AuditLogService } from "../common/audit-log.service"
import { AdminAuthGuard, type AdminRequest } from "./admin-auth.guard"
import { AdminAuthService } from "./admin-auth.service"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict()

const adminCookieName = "synapse_admin"

function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  }
}

@Controller("/api/admin")
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/login")
  async login(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = loginSchema.safeParse(body)
    if (!result.success) {
      throw new BadRequestException("登录请求无效。")
    }
    const credentials = result.data
    const session = await this.auth.login(credentials.email, credentials.password, request.ip)
    response.cookie(adminCookieName, session.token, adminCookieOptions())
    return { email: session.email, role: session.role }
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/logout")
  async logout(@Res({ passthrough: true }) response: Response, @Req() request: AdminRequest) {
    const token = request.cookies?.[adminCookieName]
    const session = typeof token === "string" ? await this.auth.verifyDashboardSession(token) : null
    if (typeof token === "string") {
      await this.auth.revokeDashboardSession(token)
    }
    response.clearCookie(adminCookieName, adminCookieOptions())
    if (session) {
      await this.auditLog?.record({
        adminEmail: session.email,
        action: session.role === "admin" ? "admin.logout" : "user.dashboard_logout",
        targetType: session.role === "admin" ? "admin" : "user",
        targetId: session.id,
        ipAddress: request.ip ?? "system",
      })
    }
    return { ok: true }
  }

  @Get("/session")
  async getSession(@Req() request: AdminRequest) {
    const token = request.cookies?.[adminCookieName]
    const session = typeof token === "string" ? await this.auth.verifyDashboardSession(token) : null
    if (!session) {
      throw new ForbiddenException("未登录或登录已过期。")
    }
    return { email: session.email, role: session.role }
  }
}
