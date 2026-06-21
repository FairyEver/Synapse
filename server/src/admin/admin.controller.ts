import { BadRequestException, Body, Controller, Delete, Get, Head, Logger, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuditLogService, auditLogExportLimit } from "../common/audit-log.service"
import { toCsv } from "../common/csv-export"
import { parsePagination } from "../common/pagination"
import { badRequestFromZodError } from "../common/zod-validation"
import { resolvePublicAppUrl } from "../invitations/invitation-url"
import { LiveDeviceService } from "../live/live-device.service"
import { WebhookService } from "../webhooks/webhook.service"
import { AdminService, maxBulkInvitationDeleteIds } from "./admin.service"

const userStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
}).strict()

const userAdminNoteSchema = z.object({
  adminNote: z.string().max(500, "最多 500 个字符").nullable(),
}).strict()

const bulkInvitationDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(maxBulkInvitationDeleteIds, `最多选择 ${maxBulkInvitationDeleteIds} 项`),
}).strict()

const createInvitationSchema = z.object({
  teamId: z.string().trim().min(1),
}).strict()

const userSortFields = ["createdAt", "updatedAt", "email", "displayName", "status"] as const
const teamSortFields = ["createdAt", "updatedAt", "name"] as const
const invitationSortFields = ["createdAt", "expiresAt", "usedAt", "type"] as const
const deviceSortFields = ["lastSeenAt", "firstSeenAt", "deviceName", "platform", "appVersion"] as const
const webhookDeliverySortFields = ["receivedAt", "status", "method"] as const
type AuditRecordInput = Parameters<AuditLogService["record"]>[0]

@UseGuards(AdminAuthGuard)
@Controller("/api/admin")
export class AdminController {
  private readonly logger = new Logger(AdminController.name)

  constructor(
    private readonly admin: AdminService,
    private readonly auditLog: AuditLogService,
    private readonly devices: LiveDeviceService,
    private readonly webhooks: WebhookService,
  ) {}

  @Get("/audit-logs")
  async listAuditLogs(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const filters = {
      action: typeof query.action === "string" ? query.action : undefined,
      from: typeof query.from === "string" ? query.from : undefined,
      to: typeof query.to === "string" ? query.to : undefined,
    }
    const result = await this.auditLog.list({
      ...filters,
      query,
    })
    await this.recordAdminRead(request, {
      action: "admin.audit_logs.list",
      targetType: "audit_log",
      targetId: "list",
      detail: filters,
    })
    return result
  }

  @Get("/system")
  async getSystemOverview(@Req() request?: AdminRequest) {
    const result = await this.admin.getSystemOverview()
    await this.recordAdminRead(request, {
      action: "admin.system.view",
      targetType: "system",
      targetId: "overview",
    })
    return result
  }

  @Get("/invitations")
  async listInvitations(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: invitationSortFields })
    const result = await this.admin.listInvitations(pagination)
    await this.recordAdminRead(request, {
      action: "admin.invitations.list",
      targetType: "invitation",
      targetId: "list",
      detail: { page: pagination.page, pageSize: pagination.pageSize },
    })
    return result
  }

  @Get("/webhook-deliveries")
  async listWebhookDeliveries(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: webhookDeliverySortFields })
    const filters = {
      userId: typeof query.userId === "string" ? query.userId : undefined,
      user: typeof query.user === "string" ? query.user : undefined,
      webhookId: typeof query.webhookId === "string" ? query.webhookId : undefined,
      status: typeof query.status === "string" ? query.status : undefined,
      from: typeof query.from === "string" ? query.from : undefined,
      to: typeof query.to === "string" ? query.to : undefined,
    }
    const result = await this.webhooks.listDeliveryHistoryForAdmin({ pagination, filters })
    await this.recordAdminRead(request, {
      action: "admin.webhook_deliveries.list",
      targetType: "webhook_delivery",
      targetId: "list",
      detail: { page: pagination.page, pageSize: pagination.pageSize, filters },
    })
    return result
  }

  @Post("/invitations")
  createInvitation(@Body() body: unknown, @Req() request: AdminRequest) {
    const result = createInvitationSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "邀请创建请求无效。")
    return this.admin.createInvitation(
      result.data,
      request.admin!,
      resolvePublicAppUrl({
        configuredPublicAppUrl: process.env.APP_PUBLIC_URL,
        request,
      }),
      request.ip,
    )
  }

  @Delete("/invitations")
  deleteInvitations(@Body() body: unknown, @Req() request?: AdminRequest) {
    const result = bulkInvitationDeleteSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "邀请 ID 无效。")
    return this.admin.deleteInvitations(result.data.ids, request?.admin?.email, request?.ip)
  }

  @Delete("/invitations/:id")
  deleteInvitation(@Param("id") id: string, @Req() request?: AdminRequest) {
    return this.admin.deleteInvitation(id, request?.admin?.email, request?.ip)
  }

  @Get("/users")
  async listUsers(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: userSortFields })
    const result = await this.admin.listUsers(pagination)
    await this.recordAdminRead(request, {
      action: "admin.users.list",
      targetType: "user",
      targetId: "list",
      detail: { page: pagination.page, pageSize: pagination.pageSize },
    })
    return result
  }

  @Get("/devices")
  async listDevices(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: deviceSortFields })
    const result = await this.devices.listAdminDevices(pagination)
    await this.recordAdminRead(request, {
      action: "admin.devices.list",
      targetType: "device",
      targetId: "list",
      detail: { page: pagination.page, pageSize: pagination.pageSize },
    })
    return result
  }

  @Patch("/users/:id/status")
  async updateUserStatus(@Param("id") id: string, @Body() body: unknown, @Req() request?: AdminRequest) {
    const result = userStatusSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "用户状态无效。")
    return this.admin.updateUserStatus(id, result.data, request?.admin?.email, request?.ip)
  }

  @Patch("/users/:id/admin-note")
  async updateUserAdminNote(@Param("id") id: string, @Body() body: unknown, @Req() request?: AdminRequest) {
    const result = userAdminNoteSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "管理员备注无效。")
    return this.admin.updateUserAdminNote(id, result.data, request?.admin?.email, request?.ip)
  }

  @Get("/teams")
  async listTeams(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: teamSortFields })
    const search = typeof query.search === "string" ? query.search.trim() : ""
    const result = await this.admin.listTeams(pagination, search ? { search } : undefined)
    await this.recordAdminRead(request, {
      action: "admin.teams.list",
      targetType: "team",
      targetId: "list",
      detail: { page: pagination.page, pageSize: pagination.pageSize, search: search || undefined },
    })
    return result
  }

  @Get("/audit-logs/export")
  async exportAuditLogs(
    @Query() query: Record<string, unknown>,
    @Req() request: AdminRequest,
    @Res() response: Response,
  ) {
    const filters = {
      action: typeof query.action === "string" ? query.action : undefined,
      from: typeof query.from === "string" ? query.from : undefined,
      to: typeof query.to === "string" ? query.to : undefined,
    }
    const data = await this.auditLog.listForExport(filters)
    if (data.length > auditLogExportLimit) {
      throw new BadRequestException(`导出记录超过 ${auditLogExportLimit} 条，请缩小时间范围。`)
    }
    const csv = toCsv(data as Record<string, unknown>[], [
      "id", "adminEmail", "action", "targetType", "targetId", "detail", "ipAddress", "createdAt",
    ])
    response.setHeader("Content-Type", "text/csv; charset=utf-8")
    response.setHeader("Content-Disposition", "attachment; filename=audit-logs.csv")
    response.send(csv)
    await this.recordAuditSafely({
      adminEmail: request.admin!.email,
      action: "admin.audit_logs.export",
      targetType: "audit_log",
      targetId: "export",
      detail: { filters, count: data.length },
      ipAddress: request.ip ?? "",
    })
  }

  @Head("/audit-logs/export")
  checkExportAuditLogs(@Res() response: Response) {
    response.setHeader("Content-Type", "text/csv; charset=utf-8")
    response.setHeader("Content-Disposition", "attachment; filename=audit-logs.csv")
    response.end()
  }

  private async recordAdminRead(
    request: AdminRequest | undefined,
    input: {
      readonly action: string
      readonly targetType: string
      readonly targetId: string
      readonly detail?: unknown
    },
  ): Promise<void> {
    await this.recordAuditSafely({
      adminEmail: request?.admin?.email ?? "system",
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.detail === undefined ? undefined : { detail: input.detail }),
      ipAddress: request?.ip ?? "system",
    })
  }

  private async recordAuditSafely(input: AuditRecordInput): Promise<void> {
    try {
      await this.auditLog.record(input)
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ...auditWriteErrorMetadata(error),
      }, "Failed to record admin audit log")
    }
  }
}

function auditWriteErrorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}
