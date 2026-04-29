import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { AdminService } from "./admin.service"

const createActivationCodeSchema = z.object({
  maxDevices: z.number().int().positive().default(1),
  expiresAt: z.string().nullable().optional(),
  quantity: z.number().int().positive().max(100).default(1),
}).strict()
type CreateActivationCodeRequest = z.infer<typeof createActivationCodeSchema>

@UseGuards(AdminAuthGuard)
@Controller("/admin/api")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("/activation-codes")
  listActivationCodes(@Query("includeArchived") includeArchived?: string) {
    return this.admin.listActivationCodes({
      includeArchived: includeArchived === "true",
    })
  }

  @Post("/activation-codes")
  createActivationCode(@Body() body: unknown) {
    return this.admin.createActivationCode(parseCreateActivationCode(body))
  }

  @Patch("/activation-codes/:id")
  updateActivationCode(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateActivationCode(id, body)
  }

  @Patch("/activation-codes/:id/archive")
  archiveActivationCode(@Param("id") id: string) {
    return this.admin.archiveActivationCode(id)
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

function parseCreateActivationCode(body: unknown): CreateActivationCodeRequest {
  const result = createActivationCodeSchema.safeParse(body)
  if (!result.success) {
    throw new BadRequestException("激活码创建请求无效。")
  }
  return result.data
}
