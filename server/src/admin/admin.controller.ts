import { BadRequestException, Body, Controller, Delete, Get, Head, Header, Logger, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { normalizeUserHandle, normalizeUserNickname, userHandleMaxLength } from "@synapse/shared"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuditLogService, auditActors, auditLogExportLimit } from "../common/audit-log.service"
import { toCsv } from "../common/csv-export"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import { LiveDeviceService } from "../live/live-device.service"
import { WebhookService } from "../webhooks/webhook.service"
import { AdminService } from "./admin.service"
import type { AdminUserListFilters } from "./admin.service"
import { AdminMailBroadcastService } from "./admin-mail-broadcast.service"
import { AdminMailService, adminMailKinds, type AdminMailKind } from "./admin-mail.service"

const userStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
}).strict()

const userAdminNoteSchema = z.object({
  adminNote: z.string().max(500, "最多 500 个字符").nullable(),
}).strict()

const userNicknameSchema = z.object({
  nickname: z.string().trim().superRefine((value, ctx) => {
    try {
      normalizeUserNickname(value)
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "昵称无效。",
      })
    }
  }),
}).strict()

const userHandleSchema = z.object({
  handle: z.string().trim().min(1).max(userHandleMaxLength).superRefine((value, ctx) => {
    try {
      normalizeUserHandle(value)
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "用户名无效。",
      })
    }
  }),
}).strict()

const mailBroadcastSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9:._-]{8,100}$/u),
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(100_000),
}).strict()

const userSortFields = ["createdAt", "updatedAt", "email", "handle", "status"] as const
const deviceSortFields = ["lastSeenAt", "firstSeenAt", "deviceName", "platform", "appVersion"] as const
const webhookDeliverySortFields = ["receivedAt", "status", "method"] as const
const skillRepositorySortFields = ["createdAt", "updatedAt", "title", "name"] as const
const mailSortFields = ["sentAt", "subject", "kind"] as const
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
    private readonly mailBroadcast: AdminMailBroadcastService,
    private readonly mail: AdminMailService,
  ) {}

  @Get("/mail/broadcasts/audience")
  @Header("Cache-Control", "no-store")
  audience() {
    return this.mailBroadcast.audience()
  }

  @Post("/mail/broadcasts")
  @Header("Cache-Control", "no-store")
  sendMailBroadcast(@Body() body: unknown, @Req() request: AdminRequest) {
    const parsed = mailBroadcastSchema.safeParse(body)
    if (!parsed.success) throw badRequestFromZodError(parsed.error, "平台公告无效。")
    return this.mailBroadcast.send(parsed.data, request.admin!.sessionId, request.ip ?? "")
  }

  @Get("/mail/messages")
  @Header("Cache-Control", "no-store")
  async listMailMessages(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination({ ...query, sortBy: query.sortBy ?? "sentAt" }, { allowedSortFields: mailSortFields })
    const filters = parseMailFilters(query)
    const result = await this.mail.listMessages(pagination, filters)
    await this.recordAdminMailRead(request, {
      action: "admin.mail.messages.list",
      targetType: "mail_message",
      targetId: "list",
      detail: { ...pagination, filters },
    })
    return result
  }

  @Get("/mail/messages/:id")
  @Header("Cache-Control", "no-store")
  async getMailMessage(@Param("id") id: string, @Req() request?: AdminRequest) {
    const result = await this.mail.getMessage(id)
    await this.recordAdminMailRead(request, {
      action: "admin.mail.message.view",
      targetType: "mail_message",
      targetId: id,
    })
    return result
  }

  @Get("/mail/messages/:id/context")
  @Header("Cache-Control", "no-store")
  async listMailContext(@Param("id") id: string, @Query("cursor") cursor?: string, @Req() request?: AdminRequest) {
    const result = await this.mail.listContext(id, cursor)
    await this.recordAdminMailRead(request, {
      action: "admin.mail.conversation.view",
      targetType: "mail_conversation",
      targetId: result.items[0]?.conversationId ?? id,
      detail: { messageId: id, cursor: cursor ?? null },
    })
    return result
  }

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

  @Get("/users")
  async listUsers(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: userSortFields })
    const filters: AdminUserListFilters = {
      search: getUserSearchValue(query.search),
      email: getUserSearchValue(query.email),
      handle: getUserSearchValue(query.handle),
      nickname: getUserSearchValue(query.nickname),
    }
    const searched = Object.values(filters).some(Boolean)
    const result = searched
      ? await this.admin.listUsers(pagination, filters)
      : await this.admin.listUsers(pagination)
    await this.recordAdminRead(request, {
      action: "admin.users.list",
      targetType: "user",
      targetId: "list",
      detail: { page: pagination.page, pageSize: pagination.pageSize, searched },
    })
    return result
  }

  @Get("/users/export")
  @Header("Cache-Control", "no-store")
  async exportUsers(@Req() request: AdminRequest, @Res() response: Response) {
    const data = await this.admin.listUsersForExport()
    const csv = toCsv(data.map((user) => ({
      "邮箱": user.email,
      "用户名": user.handle,
      "昵称": user.nickname,
    })), ["邮箱", "用户名", "昵称"])
    response.setHeader("Content-Type", "text/csv; charset=utf-8")
    response.setHeader("Content-Disposition", "attachment; filename=users.csv")
    response.send(csv)
    await this.recordAuditSafely({
      adminEmail: request.admin!.email,
      action: "admin.users.export",
      targetType: "user",
      targetId: "export",
      detail: { count: data.length },
      ipAddress: request.ip ?? "",
    })
  }

  @Head("/users/export")
  checkExportUsers(@Res() response: Response) {
    response.setHeader("Content-Type", "text/csv; charset=utf-8")
    response.setHeader("Content-Disposition", "attachment; filename=users.csv")
    response.end()
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

  @Get("/skill-repositories")
  async listSkillRepositories(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: skillRepositorySortFields })
    const status = query.status === "removed" ? "removed" : "active"
    const search = typeof query.query === "string" ? query.query.trim() : ""
    const result = await this.admin.listSkillRepositories(pagination, {
      status,
      query: search || undefined,
    })
    await this.recordAdminRead(request, {
      action: "admin.skill_repositories.list",
      targetType: "skill_repository",
      targetId: "list",
      detail: { page: pagination.page, pageSize: pagination.pageSize, status, query: search || undefined },
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

  @Patch("/users/:id/nickname")
  async updateUserNickname(@Param("id") id: string, @Body() body: unknown, @Req() request?: AdminRequest) {
    const result = userNicknameSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "昵称无效。")
    return this.admin.updateUserNickname(id, result.data, request?.admin?.email, request?.ip)
  }

  @Patch("/users/:id/handle")
  async updateUserHandle(@Param("id") id: string, @Body() body: unknown, @Req() request?: AdminRequest) {
    const result = userHandleSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "用户名无效。")
    return this.admin.updateUserHandle(id, result.data, request?.admin?.email, request?.ip)
  }

  @Post("/users/:id/password-reset-link")
  @Header("Cache-Control", "no-store")
  createUserPasswordResetLink(@Param("id") id: string, @Req() request: AdminRequest) {
    return this.admin.createUserPasswordResetLink(id, resolvePublicAppUrl({
      configuredPublicAppUrl: process.env.APP_PUBLIC_URL,
      request,
    }))
  }

  @Post("/skill-repositories/:id/removed")
  setSkillRepositoryRemoved(@Param("id") id: string, @Req() request?: AdminRequest) {
    return this.admin.setSkillRepositoryRemoved(id, true, request?.admin?.email, request?.ip)
  }

  @Delete("/skill-repositories/:id/removed")
  restoreSkillRepository(@Param("id") id: string, @Req() request?: AdminRequest) {
    return this.admin.setSkillRepositoryRemoved(id, false, request?.admin?.email, request?.ip)
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
      "id", "actorType", "actorId", "actorLabel", "adminSessionId", "action", "targetType", "targetId", "detail", "ipAddress", "createdAt",
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

  private async recordAdminMailRead(
    request: AdminRequest | undefined,
    input: { readonly action: string; readonly targetType: string; readonly targetId: string; readonly detail?: unknown },
  ): Promise<void> {
    await this.recordAuditSafely({
      ...input,
      actor: request?.admin ? auditActors.platformAdmin(request.admin.sessionId) : auditActors.system(),
      ipAddress: request?.ip ?? "system",
    })
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

function getUserSearchValue(value: unknown): string | undefined {
  const search = typeof value === "string" ? value.trim() : ""
  if (search.length > 120) throw new BadRequestException("用户搜索条件过长。")
  return search || undefined
}

function parseMailFilters(query: Record<string, unknown>) {
  const kind = typeof query.kind === "string" && query.kind ? query.kind : undefined
  if (kind !== undefined && !(adminMailKinds as readonly string[]).includes(kind)) {
    throw new BadRequestException("消息类型无效。")
  }
  const search = typeof query.search === "string" ? query.search.trim() : undefined
  if (search && search.length > 120) throw new BadRequestException("搜索词过长。")
  return {
    search: search || undefined,
    kind: kind as AdminMailKind | undefined,
    teamId: typeof query.teamId === "string" && query.teamId ? query.teamId : undefined,
    from: typeof query.from === "string" && query.from ? query.from : undefined,
    to: typeof query.to === "string" && query.to ? query.to : undefined,
  }
}

function auditWriteErrorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}
