import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { parsePagination } from "../common/pagination"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { AdminService } from "./admin.service"

const createActivationCodeSchema = z.object({
  maxDevices: z.number().int().positive().default(1),
  expiresAt: z.string().nullable().optional(),
  quantity: z.number().int().positive().max(100).default(1),
}).strict()
type CreateActivationCodeRequest = z.infer<typeof createActivationCodeSchema>
const riskLockSchema = z.object({
  locked: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict()
type RiskLockRequest = z.infer<typeof riskLockSchema>

@UseGuards(AdminAuthGuard)
@Controller("/admin/api")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("/activation-codes")
  listActivationCodes(@Query() query: Record<string, unknown>) {
    const { includeArchived, ...rest } = query as Record<string, unknown> & { includeArchived?: string }
    return this.admin.listActivationCodes(
      { includeArchived: includeArchived === "true" },
      parsePagination(rest),
    )
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

  @Get("/activation-codes/:id/attempts")
  listActivationAttempts(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.admin.listActivationAttempts(id, parsePagination(query))
  }

  @Patch("/activation-codes/:id/risk-lock")
  updateActivationCodeRiskLock(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateActivationCodeRiskLock(id, parseRiskLock(body))
  }

  @Post("/activation-codes/:id/replace")
  replaceActivationCode(@Param("id") id: string) {
    return this.admin.replaceActivationCode(id)
  }

  @Get("/accounts")
  listAccounts(@Query() query: Record<string, unknown>) {
    return this.admin.listAccounts(parsePagination(query))
  }

  @Get("/accounts/:id")
  getAccount(@Param("id") id: string) {
    return this.admin.getAccount(id)
  }

  @Get("/devices")
  listDevices(@Query() query: Record<string, unknown>) {
    return this.admin.listDevices(parsePagination(query))
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

function parseRiskLock(body: unknown): RiskLockRequest {
  const result = riskLockSchema.safeParse(body)
  if (!result.success) {
    throw new BadRequestException("风控状态请求无效。")
  }
  return result.data
}
