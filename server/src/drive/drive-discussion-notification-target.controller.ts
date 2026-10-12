import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { DriveDiscussionNotificationTargetService } from "./drive-discussion-notification-target.service"

@Controller("/api/notifications")
@UseGuards(UserAuthGuard)
export class DriveDiscussionNotificationTargetController {
  constructor(private readonly targets: DriveDiscussionNotificationTargetService) {}
  @Get(":id/drive-target")
  resolve(@Req() request: { user: { id: string } }, @Param("id") id: string) {
    return this.targets.resolve(request.user.id, id)
  }
}
