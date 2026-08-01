import { Body, Controller, Delete, Get, Post, Req, Res, UnauthorizedException } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request, Response } from "express"
import { z } from "zod"
import { badRequestFromZodError } from "../common/zod-validation"
import { AdminAuthService, adminSessionMaxAgeMs } from "./admin-auth.service"
import { assertTrustedAdminOrigin } from "./admin-origin"

const accessSchema = z.object({
  accessSecret: z.string().min(1).max(4096),
}).strict()

export const adminSessionCookieName = "synapse_admin_session"
const legacyDashboardCookieName = "synapse_admin"

function adminCookieOptions() {
  return {
    httpOnly: true,
    maxAge: adminSessionMaxAgeMs,
    path: "/api/admin",
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
  }
}

function adminCookieClearOptions() {
  return {
    httpOnly: true,
    path: "/api/admin",
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
  }
}

function clearLegacyDashboardCookie(response: Response): void {
  response.clearCookie(legacyDashboardCookieName, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  })
}

@Controller("/api/admin")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/session")
  async createSession(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertTrustedAdminOrigin(request)
    const result = accessSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "密钥无效。")
    const created = await this.auth.createSession(result.data.accessSecret, request.ip ?? "")
    if (!created) throw new UnauthorizedException("密钥无效。")
    response.cookie(adminSessionCookieName, created.token, adminCookieOptions())
    clearLegacyDashboardCookie(response)
    return {
      actorLabel: "平台管理员",
      sessionId: created.session.sessionId,
      expiresAt: created.session.expiresAt,
    }
  }

  @Get("/session")
  async getSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    clearLegacyDashboardCookie(response)
    const token = request.cookies?.[adminSessionCookieName]
    const verification = typeof token === "string"
      ? await this.auth.verifySession(token)
      : { status: "invalid" as const }
    if (verification.status !== "active") {
      response.clearCookie(adminSessionCookieName, adminCookieClearOptions())
      await this.auth.recordRejectedSession(verification, request.ip ?? "")
      throw new UnauthorizedException("管理会话无效或已过期。")
    }
    return {
      actorLabel: "平台管理员",
      sessionId: verification.session.sessionId,
      expiresAt: verification.session.expiresAt,
    }
  }

  @Delete("/session")
  async deleteSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertTrustedAdminOrigin(request)
    const token = request.cookies?.[adminSessionCookieName]
    try {
      if (typeof token === "string") await this.auth.revokeSession(token, request.ip ?? "")
    } finally {
      response.clearCookie(adminSessionCookieName, adminCookieClearOptions())
      clearLegacyDashboardCookie(response)
    }
    return { ok: true }
  }
}
