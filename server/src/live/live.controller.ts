import { Body, Controller, Get, Param, Patch, Req, Sse, UseGuards } from "@nestjs/common"
import { map } from "rxjs"
import { z } from "zod"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import type { AdminRequest } from "../admin-auth/admin-auth.guard"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { LiveDeviceService } from "./live-device.service"
import { LiveQueryService } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"

const renameDeviceSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
}).strict()

@Controller()
export class LiveController {
  constructor(
    private readonly query: LiveQueryService,
    private readonly streams: LiveStreamService,
    private readonly devices: LiveDeviceService,
  ) {}

  @UseGuards(AdminAuthGuard)
  @Get("/api/admin/live-clients")
  listAdminClients() {
    return this.query.listAdminClients()
  }

  @UseGuards(AdminAuthGuard)
  @Get("/api/admin/users/:id/live-clients")
  listAdminUserClients(@Param("id") userId: string) {
    return this.query.listAdminUserClients(userId)
  }

  @UseGuards(AdminAuthGuard)
  @Sse("/api/admin/live/stream")
  adminStream(@Req() _request: AdminRequest) {
    return this.streams.adminEvents().pipe(map((event) => ({ type: event.type, data: event })))
  }

  @UseGuards(UserAuthGuard)
  @Get("/api/dashboard/live-clients")
  listDashboardClients(@Req() request: AuthenticatedUserRequest) {
    return this.query.listUserClients(request.user!.id)
  }

  @UseGuards(UserAuthGuard)
  @Get("/api/dashboard/devices")
  listDashboardDevices(@Req() request: AuthenticatedUserRequest) {
    return this.devices.listUserDevices(request.user!.id)
  }

  @UseGuards(UserAuthGuard)
  @Patch("/api/dashboard/devices/:clientInstanceId")
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
  @Sse("/api/dashboard/live/stream")
  dashboardStream(@Req() request: AuthenticatedUserRequest) {
    return this.streams.userEvents(request.user!.id).pipe(map((event) => ({ type: event.type, data: event })))
  }
}
