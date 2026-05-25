import { Controller, Get, Req, UseGuards } from "@nestjs/common"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { UserAuthService } from "../auth/user-auth.service"

@UseGuards(UserAuthGuard)
@Controller("/api/dashboard")
export class DashboardController {
  constructor(private readonly auth: UserAuthService) {}

  @Get("/me")
  me(@Req() request: AuthenticatedUserRequest) {
    return this.auth.getMe(request.user!.id)
  }
}
