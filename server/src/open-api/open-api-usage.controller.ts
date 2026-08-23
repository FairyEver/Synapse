import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { parsePagination } from "../common/pagination"
import { OpenApiUsageLogService } from "./open-api-usage-log.service"

@UseGuards(UserAuthGuard)
@Controller(["/api/console", "/api/dashboard"])
export class OpenApiUsageController {
  constructor(private readonly usageLogs: OpenApiUsageLogService) {}

  @Get("/api-keys/:apiKeyId/usage-logs")
  list(
    @Param("apiKeyId") apiKeyId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const pagination = parsePagination(query, { allowedSortFields: ["startedAt"] })
    return this.usageLogs.listForUser(request.user!.id, apiKeyId, pagination)
  }
}
