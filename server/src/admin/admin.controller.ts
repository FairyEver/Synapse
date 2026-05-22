import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuditLogService } from "../common/audit-log.service"
import { toCsv } from "../common/csv-export"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../invitations/invitation-url"
import { AdminService } from "./admin.service"

const userStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
}).strict()

const bulkInvitationDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
}).strict()

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
    )
  }

  @Get("/invitations")
  listInvitations(@Query() query: Record<string, unknown>) {
    return this.admin.listInvitations(parsePagination(query))
  }

  @Delete("/invitations")
  deleteInvitations(@Body() body: unknown, @Req() request?: AdminRequest) {
    const result = bulkInvitationDeleteSchema.safeParse(body)
    if (!result.success) throw new BadRequestException("邀请 ID 无效。")
    return this.admin.deleteInvitations(result.data.ids, request?.admin?.email)
  }

  @Delete("/invitations/:id")
  deleteInvitation(@Param("id") id: string, @Req() request?: AdminRequest) {
    return this.admin.deleteInvitation(id, request?.admin?.email)
  }

  @Get("/users")
  listUsers(@Query() query: Record<string, unknown>) {
    return this.admin.listUsers(parsePagination(query))
  }

  @Patch("/users/:id/status")
  async updateUserStatus(@Param("id") id: string, @Body() body: unknown, @Req() request?: AdminRequest) {
    const result = userStatusSchema.safeParse(body)
    if (!result.success) throw new BadRequestException("用户状态无效。")
    return this.admin.updateUserStatus(id, result.data, request?.admin?.email)
  }

  @Get("/teams")
  listTeams(@Query() query: Record<string, unknown>) {
    return this.admin.listTeams(parsePagination(query))
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
