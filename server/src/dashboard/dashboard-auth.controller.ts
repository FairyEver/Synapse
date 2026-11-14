import { Body, Controller, Get, Header, Post, Req, Res, UnauthorizedException } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request, Response } from "express"
import { z } from "zod"
import { UserAuthService } from "../auth/user-auth.service"
import { assertCookieOrigin } from "../auth/cookie-origin"
import { userSessionCookieName } from "../auth/user-web-session"
import { badRequestFromZodError } from "../common/zod-validation"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict()

const legacyDashboardCookieName = "synapse_admin"

function userCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  }
}

function userCookieClearOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  }
}

function clearLegacyDashboardCookie(response: Response): void {
  for (const path of ["/api", "/drive"]) response.clearCookie("synapse_user_session", { httpOnly: true, path, sameSite: "lax", secure: process.env.NODE_ENV === "production" })
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
    assertCookieOrigin(request, process.env.APP_PUBLIC_URL)
    const result = loginSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "登录请求无效。")
    const session = await this.auth.loginWeb(result.data, request.ip)
    response.cookie(userSessionCookieName, session.token, userCookieOptions(session.expiresAt))
    clearLegacyDashboardCookie(response)
    return {
      userId: session.user.id,
      email: session.user.email,
      handle: session.user.handle,
      nickname: session.user.nickname,
      avatarUrl: session.user.avatarUrl,
      sessionId: session.sessionId,
    }
  }

  @Get("/session")
  @Header("Cache-Control", "no-store")
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
    response.cookie(userSessionCookieName, token, userCookieOptions(session.expiresAt))
    return {
      userId: me.user.id,
      email: me.user.email,
      handle: me.user.handle,
      nickname: me.user.nickname,
      avatarUrl: me.user.avatarUrl,
      sessionId: session.sessionId,
    }
  }

  @Post("/logout")
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertCookieOrigin(request, process.env.APP_PUBLIC_URL)
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
