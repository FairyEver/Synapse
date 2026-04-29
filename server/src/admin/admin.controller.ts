import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { AdminService } from "./admin.service"

const createActivationCodeSchema = z.object({
  code: z.string().min(6),
  maxDevices: z.number().int().positive().default(1),
  expiresAt: z.string().nullable().optional(),
})

@UseGuards(AdminAuthGuard)
@Controller("/admin/api")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("/activation-codes")
  listActivationCodes() {
    return this.admin.listActivationCodes()
  }

  @Post("/activation-codes")
  createActivationCode(@Body() body: unknown) {
    return this.admin.createActivationCode(createActivationCodeSchema.parse(body))
  }

  @Patch("/activation-codes/:id")
  updateActivationCode(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateActivationCode(id, body)
  }

  @Get("/accounts")
  listAccounts() {
    return this.admin.listAccounts()
  }

  @Get("/accounts/:id")
  getAccount(@Param("id") id: string) {
    return this.admin.getAccount(id)
  }

  @Get("/devices")
  listDevices() {
    return this.admin.listDevices()
  }

  @Get("/system")
  getSystemOverview() {
    return this.admin.getSystemOverview()
  }

  @Patch("/licenses/:id")
  updateLicense(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateLicense(id, body)
  }

  @Patch("/devices/:id")
  updateDevice(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateDevice(id, body)
  }
}
