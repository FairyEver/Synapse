import { Body, Controller, Get, Post, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { AdminAuthGuard } from "./admin-auth.guard"
import { AdminAuthService } from "./admin-auth.service"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

@Controller("/admin")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post("/login")
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const request = loginSchema.parse(body)
    const session = await this.auth.login(request.email, request.password)
    response.cookie("synapse_admin", session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
    return { email: session.email }
  }

  @Post("/logout")
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie("synapse_admin")
    return { ok: true }
  }

  @UseGuards(AdminAuthGuard)
  @Get("/session")
  getSession() {
    return { email: this.auth.getEmail() }
  }
}
