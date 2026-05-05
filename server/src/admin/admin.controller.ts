import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { parsePagination } from "../common/pagination"
import { toCsv } from "../common/csv-export"
import { AuditLogService } from "../common/audit-log.service"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { AdminService } from "./admin.service"

const createActivationCodeSchema = z.object({
  maxDevices: z.number().int().positive().default(1),
  expiresAt: z.string().nullable().optional(),
  quantity: z.number().int().positive().max(100).default(1),
  reservedEmail: z.string().email().nullable().optional(),
  reservedEmails: z.array(z.string().email()).max(100).nullable().optional(),
}).strict().refine(
  (data) => !(data.reservedEmail && data.reservedEmails),
  { message: "reservedEmail 和 reservedEmails 不能同时使用。" },
)
type CreateActivationCodeRequest = z.infer<typeof createActivationCodeSchema>
const riskLockSchema = z.object({
  locked: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict()
type RiskLockRequest = z.infer<typeof riskLockSchema>
const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
  action: z.enum(["archive", "updateStatus"]),
  status: z.string().optional(),
}).strict()
const deviceBatchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
  action: z.literal("updateStatus"),
  status: z.string(),
}).strict()

@UseGuards(AdminAuthGuard)
@Controller("/admin/api")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auditLog: AuditLogService,
  ) {}

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

  @Get("/audit-logs")
  listAuditLogs(@Query() query: Record<string, unknown>) {
    return this.auditLog.list({
      action: typeof query.action === "string" ? query.action : undefined,
      from: typeof query.from === "string" ? query.from : undefined,
      to: typeof query.to === "string" ? query.to : undefined,
      query,
    })
  }

  @Get("/system")
  getSystemOverview() {
    return this.admin.getSystemOverview()
  }

  @Get("/licenses")
  listLicenses(@Query() query: Record<string, unknown>) {
    return this.admin.listLicenses({
      status: typeof query.status === "string" ? query.status : undefined,
      accountId: typeof query.accountId === "string" ? query.accountId : undefined,
      query,
    })
  }

  @Get("/licenses/:id")
  getLicense(@Param("id") id: string) {
    return this.admin.getLicense(id)
  }

  @Patch("/accounts/:id/status")
  updateAccountStatus(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateAccountStatus(id, body)
  }

  @Patch("/licenses/:id")
  updateLicense(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateLicense(id, body)
  }

  @Patch("/devices/:id")
  updateDevice(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateDevice(id, body)
  }

  @Post("/activation-codes/batch")
  batchUpdateActivationCodes(@Body() body: unknown) {
    const result = batchSchema.safeParse(body)
    if (!result.success) {
      throw new BadRequestException("批量操作请求无效。")
    }
    return this.admin.batchUpdateActivationCodes(result.data)
  }

  @Post("/devices/batch")
  batchUpdateDevices(@Body() body: unknown) {
    const result = deviceBatchSchema.safeParse(body)
    if (!result.success) {
      throw new BadRequestException("批量操作请求无效。")
    }
    return this.admin.batchUpdateDevices(result.data)
  }

  @Get("/activation-codes/export")
  async exportActivationCodes(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const result = await this.admin.listActivationCodes(
      { includeArchived: query.includeArchived === "true" },
      parsePagination({ ...query, pageSize: "10000" }),
    )
    const csv = toCsv(result.data as Record<string, unknown>[], [
      "id", "codeHint", "status", "maxDevices", "expiresAt", "createdAt",
    ])
    response.setHeader("Content-Type", "text/csv; charset=utf-8")
    response.setHeader("Content-Disposition", "attachment; filename=activation-codes.csv")
    response.send(csv)
  }

  @Get("/audit-logs/export")
  async exportAuditLogs(
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const result = await this.auditLog.list({
      action: typeof query.action === "string" ? query.action : undefined,
      from: typeof query.from === "string" ? query.from : undefined,
      to: typeof query.to === "string" ? query.to : undefined,
      query: { ...query, pageSize: "10000" },
    })
    const csv = toCsv(result.data as Record<string, unknown>[], [
      "id", "adminEmail", "action", "targetType", "targetId", "ipAddress", "createdAt",
    ])
    response.setHeader("Content-Type", "text/csv; charset=utf-8")
    response.setHeader("Content-Disposition", "attachment; filename=audit-logs.csv")
    response.send(csv)
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
