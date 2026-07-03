import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import {
  DESKTOP_CLIENT_ID,
  DESKTOP_PKCE_CHALLENGE_METHOD,
  DESKTOP_REDIRECT_URI,
  normalizeUserHandle,
  userHandleMaxLength,
} from "@synapse/shared"
import type { Request } from "express"
import { z } from "zod"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import { AuthenticatedUserRequest, UserAuthGuard } from "./user-auth.guard"
import { UserAuthService } from "./user-auth.service"

const registerSchema = z.object({
  email: z.string().email(),
  handle: z.string().trim().min(1).max(userHandleMaxLength).superRefine((value, ctx) => {
    if (!value || value.length > userHandleMaxLength) return
    try {
      normalizeUserHandle(value)
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "用户名无效。",
      })
    }
  }),
  password: z.string().min(8),
}).strict()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict()

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
}).strict()

const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(8),
}).strict()

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
}).strict()

const desktopAuthorizeSchema = z.object({
  clientId: z.literal(DESKTOP_CLIENT_ID),
  redirectUri: z.literal(DESKTOP_REDIRECT_URI),
  state: z.string().trim().min(16),
  codeChallenge: z.string().trim().min(16),
  codeChallengeMethod: z.literal(DESKTOP_PKCE_CHALLENGE_METHOD),
}).strict()

const desktopTokenSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(16),
  codeVerifier: z.string().trim().min(16),
}).strict()

@Controller("/api/auth")
export class UserAuthController {
  constructor(private readonly auth: UserAuthService) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/register")
  register(@Body() body: unknown, @Req() request: Request) {
    return this.auth.register(parseBody(registerSchema, body, "注册请求无效。"), request.ip)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/login")
  login(@Body() body: unknown, @Req() request: Request) {
    return this.auth.login(parseBody(loginSchema, body, "登录请求无效。"), request.ip)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/password-reset/request")
  requestPasswordReset(@Body() body: unknown, @Req() request: Request) {
    const input = parseBody(passwordResetRequestSchema, body, "找回密码请求无效。")
    return this.auth.requestPasswordReset({
      email: input.email,
      publicAppUrl: resolvePublicAppUrl({
        configuredPublicAppUrl: process.env.APP_PUBLIC_URL,
        request,
      }),
    }, readRequestIp(request))
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/password-reset/confirm")
  resetPassword(@Body() body: unknown, @Req() request: Request) {
    return this.auth.resetPassword(
      parseBody(passwordResetConfirmSchema, body, "重设密码请求无效。"),
      readRequestIp(request),
    )
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/refresh")
  refresh(@Body() body: unknown, @Req() request: Request) {
    return this.auth.refresh(parseBody(refreshSchema, body, "刷新请求无效。"), request.ip)
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/logout")
  logout(@Body() body: unknown, @Req() request: Request) {
    return this.auth.logout(parseBody(refreshSchema, body, "退出请求无效。"), request.ip)
  }

  @UseGuards(UserAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post("/desktop/authorize")
  authorizeDesktop(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const input = parseBody(desktopAuthorizeSchema, body, "登录请求无效。")
    return this.auth.authorizeDesktopLogin({
      userId: request.user!.id,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      state: input.state,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      ipAddress: readRequestIp(request),
      userAgent: readHeaderText(request.headers["user-agent"]),
    })
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post("/desktop/token")
  issueDesktopToken(@Body() body: unknown, @Req() request: Request) {
    const input = parseBody(desktopTokenSchema, body, "登录请求无效。")
    return this.auth.exchangeDesktopLoginToken({
      code: input.code,
      state: input.state,
      codeVerifier: input.codeVerifier,
      ipAddress: readRequestIp(request),
    })
  }

  @UseGuards(UserAuthGuard)
  @Get("/me")
  me(@Req() request: AuthenticatedUserRequest) {
    return this.auth.getMe(request.user!.id)
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw badRequestFromZodError(result.error, message)
  }
  return result.data
}

function readHeaderText(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header.join(", ") : header
}

function readRequestIp(request: Request): string {
  return request.ip ?? "unknown"
}
