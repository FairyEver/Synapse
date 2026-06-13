import { Body, Controller, Get, Logger, Optional, Param, Patch, Req, Sse, UseGuards } from "@nestjs/common"
import { map } from "rxjs"
import { z } from "zod"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import type { AdminRequest } from "../admin-auth/admin-auth.guard"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { AuditLogService } from "../common/audit-log.service"
import { badRequestFromZodError } from "../common/zod-validation"
import { LiveDeviceService } from "./live-device.service"
import { LiveQueryService } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"

const renameDeviceSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
}).strict()
type AuditRecordInput = Parameters<AuditLogService["record"]>[0]

@Controller()
export class LiveController {
  private readonly logger = new Logger(LiveController.name)

  constructor(
    private readonly query: LiveQueryService,
    private readonly streams: LiveStreamService,
    private readonly devices: LiveDeviceService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  @UseGuards(AdminAuthGuard)
  @Get("/api/admin/live-clients")
  async listAdminClients(@Req() request?: AdminRequest) {
    const result = this.query.listAdminClients()
    await this.recordAuditSafely({
      adminEmail: request?.admin?.email ?? "system",
      action: "admin.live_clients.list",
      targetType: "live_client",
      targetId: "list",
      detail: { scope: "all", count: result.length },
      ipAddress: request?.ip ?? "system",
    })
    return result
  }

  @UseGuards(AdminAuthGuard)
  @Get("/api/admin/users/:id/live-clients")
  async listAdminUserClients(@Param("id") userId: string, @Req() request?: AdminRequest) {
    const result = this.query.listAdminUserClients(userId)
    await this.recordAuditSafely({
      adminEmail: request?.admin?.email ?? "system",
      action: "admin.live_clients.list",
      targetType: "live_client",
      targetId: userId,
      detail: { scope: "user", userId, count: result.length },
      ipAddress: request?.ip ?? "system",
    })
    return result
  }

  @UseGuards(AdminAuthGuard)
  @Sse("/api/admin/live/stream")
  adminStream(@Req() request: AdminRequest) {
    void this.recordAuditSafely({
      adminEmail: request.admin?.email ?? "system",
      action: "admin.live_clients.stream",
      targetType: "live_client",
      targetId: "stream",
      detail: { scope: "all" },
      ipAddress: request.ip ?? "system",
    })
    return this.streams.adminEvents().pipe(map((event) => ({ type: event.type, data: event })))
  }

  @UseGuards(UserAuthGuard)
  @Get(["/api/console/live-clients", "/api/dashboard/live-clients"])
  listDashboardClients(@Req() request: AuthenticatedUserRequest) {
    return this.query.listUserClients(request.user!.id)
  }

  @UseGuards(UserAuthGuard)
  @Get(["/api/console/devices", "/api/dashboard/devices"])
  listDashboardDevices(@Req() request: AuthenticatedUserRequest) {
    return this.devices.listUserDevices(request.user!.id)
  }

  @UseGuards(UserAuthGuard)
  @Patch(["/api/console/devices/:clientInstanceId", "/api/dashboard/devices/:clientInstanceId"])
  renameDashboardDevice(
    @Param("clientInstanceId") clientInstanceId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const result = renameDeviceSchema.safeParse(body)
    if (!result.success) throw badRequestFromZodError(result.error, "设备名称无效。")
    return this.devices.renameUserDevice(request.user!.id, clientInstanceId, result.data.displayName)
  }

  @UseGuards(UserAuthGuard)
  @Sse("/api/console/live/stream")
  dashboardStream(@Req() request: AuthenticatedUserRequest) {
    return this.streams.userEvents(request.user!.id).pipe(map((event) => ({ type: event.type, data: event })))
  }

  @UseGuards(UserAuthGuard)
  @Sse("/api/dashboard/live/stream")
  legacyDashboardStream(@Req() request: AuthenticatedUserRequest) {
    return this.dashboardStream(request)
  }

  private async recordAuditSafely(input: AuditRecordInput): Promise<void> {
    try {
      await this.auditLog?.record(input)
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Failed to record live admin audit log")
    }
  }
}
