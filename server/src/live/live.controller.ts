import { Controller, Get, Param, Req, Sse, UseGuards } from "@nestjs/common"
import { map } from "rxjs"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import type { AdminRequest } from "../admin-auth/admin-auth.guard"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { LiveQueryService } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"

@Controller()
export class LiveController {
  constructor(
    private readonly query: LiveQueryService,
    private readonly streams: LiveStreamService,
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
  @Sse("/api/dashboard/live/stream")
  dashboardStream(@Req() request: AuthenticatedUserRequest) {
    return this.streams.userEvents(request.user!.id).pipe(map((event) => ({ type: event.type, data: event })))
  }
}
