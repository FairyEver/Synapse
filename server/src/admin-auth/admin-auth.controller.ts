import { Body, Controller, Get, Logger, Optional, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Response } from "express"
import { z } from "zod"
import { hashToken } from "../auth/token"
import { AuditLogService } from "../common/audit-log.service"
import { formatAuditError } from "../common/audit-error"
import { badRequestFromZodError } from "../common/zod-validation"
import { AdminAuthGuard, type AdminRequest } from "./admin-auth.guard"
import { AdminAuthService } from "./admin-auth.service"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict()

const adminCookieName = "synapse_admin"
const dashboardSessionMaxAgeMs = 30 * 24 * 60 * 60 * 1000

function adminCookieOptions() {
  return {
    httpOnly: true,
    maxAge: dashboardSessionMaxAgeMs,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  }
}

function adminCookieClearOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  }
}

@Controller(["/api/console", "/api/dashboard"])
export class AdminAuthController {
  private readonly logger = new Logger(AdminAuthController.name)

  constructor(
    private readonly auth: AdminAuthService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/login")
  async login(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = loginSchema.safeParse(body)
    if (!result.success) {
      throw badRequestFromZodError(result.error, "登录请求无效。")
    }
    const credentials = result.data
    const session = await this.auth.login(credentials.email, credentials.password, request.ip)
    response.cookie(adminCookieName, session.token, adminCookieOptions())
    return {
      email: session.email,
      handle: session.handle,
      role: session.role,
      sessionId: hashToken(session.token),
    }
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/logout")
  async logout(@Res({ passthrough: true }) response: Response, @Req() request: AdminRequest) {
    const token = request.cookies?.[adminCookieName]
    const session = typeof token === "string" ? await this.auth.verifyDashboardSession(token) : null
    if (session) {
      await this.recordLogoutAuditSafely({
        adminEmail: session.email,
        action: session.role === "admin" ? "admin.logout" : "user.dashboard_logout",
        targetType: session.role === "admin" ? "admin" : "user",
        targetId: session.id,
        ipAddress: request.ip ?? "system",
      })
    }
    try {
      if (typeof token === "string") {
        await this.auth.revokeDashboardSession(token)
      }
    } finally {
      response.clearCookie(adminCookieName, adminCookieClearOptions())
    }
    return { ok: true }
  }

  private async recordLogoutAuditSafely(input: Parameters<AuditLogService["record"]>[0]): Promise<void> {
    try {
      await this.auditLog?.record(input)
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        error: formatAuditError(error),
      }, "Failed to record dashboard logout audit log")
    }
  }

  @Get("/session")
  async getSession(@Req() request: AdminRequest) {
    const token = request.cookies?.[adminCookieName]
    const session = typeof token === "string" ? await this.auth.verifyDashboardSession(token) : null
    if (!session) {
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    return {
      email: session.email,
      handle: session.handle,
      role: session.role,
      sessionId: hashToken(token),
    }
  }
}
