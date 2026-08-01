import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request, Response } from "express"
import { z } from "zod"
import { UserAuthService } from "../auth/user-auth.service"
import { userSessionCookieName } from "../auth/user-web-session"
import { badRequestFromZodError } from "../common/zod-validation"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict()

const legacyDashboardCookieName = "synapse_admin"
const userSessionMaxAgeMs = 30 * 24 * 60 * 60 * 1000

function userCookieOptions() {
  return {
    httpOnly: true,
    maxAge: userSessionMaxAgeMs,
    path: "/api",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  }
}

function userCookieClearOptions() {
  return {
    httpOnly: true,
    path: "/api",
    sameSite: "lax" as const,
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

@Controller(["/api/console", "/api/dashboard"])
export class DashboardAuthController {
  constructor(private readonly auth: UserAuthService) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/login")
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = loginSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "登录请求无效。")
    const session = await this.auth.loginWeb(result.data, request.ip)
    response.cookie(userSessionCookieName, session.token, userCookieOptions())
    clearLegacyDashboardCookie(response)
    return {
      email: session.user.email,
      handle: session.user.handle,
      sessionId: session.sessionId,
    }
  }

  @Get("/session")
  async session(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    clearLegacyDashboardCookie(response)
    const token = request.cookies?.[userSessionCookieName]
    const session = typeof token === "string" ? await this.auth.verifyWebSession(token) : null
    if (!session) {
      response.clearCookie(userSessionCookieName, userCookieClearOptions())
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    const me = await this.auth.getMe(session.userId)
    return {
      email: me.user.email,
      handle: me.user.handle,
      sessionId: session.sessionId,
    }
  }

  @Post("/logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.cookies?.[userSessionCookieName]
    try {
      if (typeof token === "string") await this.auth.logoutWeb(token, request.ip)
    } finally {
      response.clearCookie(userSessionCookieName, userCookieClearOptions())
      clearLegacyDashboardCookie(response)
    }
    return { ok: true }
  }
}
