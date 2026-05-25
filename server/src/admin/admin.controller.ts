import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuditLogService, auditLogExportLimit } from "../common/audit-log.service"
import { toCsv } from "../common/csv-export"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../invitations/invitation-url"
import { isActiveModulePermissionKey } from "../permissions/permission-registry"
import { AdminService } from "./admin.service"

const userStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
}).strict()

const bulkInvitationDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
}).strict()

const modulePermissionKeysSchema = z.array(z.string().trim().min(1).refine(isActiveModulePermissionKey))

const userModulePermissionsSchema = z.object({
  permissionKeys: modulePermissionKeysSchema,
}).strict()

const userSortFields = ["createdAt", "updatedAt", "email", "status"] as const
const teamSortFields = ["createdAt", "updatedAt", "name"] as const
const invitationSortFields = ["createdAt", "expiresAt", "usedAt", "type"] as const

@UseGuards(AdminAuthGuard)
@Controller("/api/admin")
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auditLog: AuditLogService,
  ) {}

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

  @Post("/invitations")
  createSignupInvitation(@Req() request: AdminRequest) {
    return this.admin.createSignupInvitation(
      request.admin!,
      resolvePublicAppUrl({
        configuredPublicAppUrl: process.env.APP_PUBLIC_URL,
        request,
      }),
      request.ip,
    )
  }

  @Get("/invitations")
  listInvitations(@Query() query: Record<string, unknown>) {
    return this.admin.listInvitations(parsePagination(query, { allowedSortFields: invitationSortFields }))
  }

  @Delete("/invitations")
  deleteInvitations(@Body() body: unknown, @Req() request?: AdminRequest) {
    const result = bulkInvitationDeleteSchema.safeParse(body)
    if (!result.success) throw new BadRequestException("邀请 ID 无效。")
    return this.admin.deleteInvitations(result.data.ids, request?.admin?.email, request?.ip)
  }

  @Delete("/invitations/:id")
  deleteInvitation(@Param("id") id: string, @Req() request?: AdminRequest) {
    return this.admin.deleteInvitation(id, request?.admin?.email, request?.ip)
  }

  @Get("/users")
  listUsers(@Query() query: Record<string, unknown>) {
    return this.admin.listUsers(parsePagination(query, { allowedSortFields: userSortFields }))
  }

  @Patch("/users/:id/status")
  async updateUserStatus(@Param("id") id: string, @Body() body: unknown, @Req() request?: AdminRequest) {
    const result = userStatusSchema.safeParse(body)
    if (!result.success) throw new BadRequestException("用户状态无效。")
    return this.admin.updateUserStatus(id, result.data, request?.admin?.email, request?.ip)
  }

  @Get("/teams")
  listTeams(@Query() query: Record<string, unknown>) {
    return this.admin.listTeams(parsePagination(query, { allowedSortFields: teamSortFields }))
  }

  @Get("/module-permissions")
  listModulePermissions() {
    return this.admin.listModulePermissions()
  }

  @Get("/users/:id/module-permissions")
  listUserModulePermissions(@Param("id") id: string) {
    return this.admin.listUserModulePermissions(id)
  }

  @Put("/users/:id/module-permissions")
  async replaceUserModulePermissions(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
  ) {
    const result = userModulePermissionsSchema.safeParse(body)
    if (!result.success) throw new BadRequestException("用户模块权限无效。")
    return this.admin.replaceUserModulePermissions(id, result.data.permissionKeys, request.admin!, request.ip)
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
    await this.auditLog.record({
      adminEmail: request.admin!.email,
      action: "admin.audit_logs.export",
      targetType: "audit_log",
      targetId: "export",
      detail: { filters, count: data.length },
      ipAddress: request.ip ?? "",
    })
  }
}
