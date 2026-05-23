import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "./user-auth.guard"
import { UserAuthService } from "./user-auth.service"

const registerSchema = z.object({
  invitationToken: z.string().min(1),
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

@Controller("/api/auth")
export class UserAuthController {
  constructor(private readonly auth: UserAuthService) {}

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/register")
  register(@Body() body: unknown) {
    return this.auth.register(parseBody(registerSchema, body, "注册请求无效。"))
  }

  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("/login")
  login(@Body() body: unknown) {
    return this.auth.login(parseBody(loginSchema, body, "登录请求无效。"))
  }

  @Post("/refresh")
  refresh(@Body() body: unknown) {
    return this.auth.refresh(parseBody(refreshSchema, body, "刷新请求无效。"))
  }

  @Post("/logout")
  logout(@Body() body: unknown) {
    return this.auth.logout(parseBody(refreshSchema, body, "退出请求无效。"))
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
    throw new BadRequestException(message)
  }
  return result.data
}
