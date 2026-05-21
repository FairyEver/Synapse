import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { AuditLogService } from "../common/audit-log.service"
import { toCsv } from "../common/csv-export"
import { AdminService } from "./admin.service"

@UseGuards(AdminAuthGuard)
@Controller("/admin/api")
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
