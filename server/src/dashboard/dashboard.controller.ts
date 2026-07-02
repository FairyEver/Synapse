import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { UserAuthService } from "../auth/user-auth.service"
import { badRequestFromZodError } from "../common/zod-validation"

const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  handle: z.string().trim().min(1).max(64).optional(),
}).strict().refine(
  (value) => value.displayName !== undefined || value.handle !== undefined,
  "Profile update request is empty.",
)

@UseGuards(UserAuthGuard)
@Controller(["/api/console", "/api/dashboard"])
export class DashboardController {
  constructor(private readonly auth: UserAuthService) {}

  @Get("/me")
  me(@Req() request: AuthenticatedUserRequest) {
    return this.auth.getMe(request.user!.id)
  }

  @Patch("/me")
  async updateMe(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const result = updateMeSchema.safeParse(body)
    if (!result.success) {
      throw badRequestFromZodError(result.error, "Profile update request is invalid.")
    }
    return this.auth.updateMyProfile(request.user!.id, result.data, request.ip)
  }
}
