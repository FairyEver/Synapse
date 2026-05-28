import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request } from "express"
import { z } from "zod"
import { badRequestFromZodError } from "../common/zod-validation"
import { AuthenticatedUserRequest, UserAuthGuard } from "./user-auth.guard"
import { UserAuthService } from "./user-auth.service"

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
}).strict()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict()

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
}).strict()

const desktopIssueCodeSchema = z.object({
  state: z.string().trim().min(16),
}).strict()

const desktopExchangeSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(16),
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
  @Post("/desktop/issue-code")
  issueDesktopCode(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const input = parseBody(desktopIssueCodeSchema, body, "登录请求无效。")
    return this.auth.issueDesktopLoginCode({
      userId: request.user!.id,
      state: input.state,
      ipAddress: request.ip,
      userAgent: readHeaderText(request.headers["user-agent"]),
    })
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post("/desktop/exchange")
  exchangeDesktopCode(@Body() body: unknown, @Req() request: Request) {
    const input = parseBody(desktopExchangeSchema, body, "登录请求无效。")
    return this.auth.exchangeDesktopLoginCode({
      code: input.code,
      state: input.state,
      ipAddress: request.ip,
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
