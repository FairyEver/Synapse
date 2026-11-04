import { Controller, Get, Header, Query, Req, UseGuards } from "@nestjs/common"
import { skillHubTeamQuerySchema } from "@synapse/shared/skill-hub-contracts"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { hubError } from "./skill-hub-error"
import { SkillHubTeamService } from "./skill-hub-team.service"

@UseGuards(UserAuthGuard)
@Controller("/api/skill-hub/teams")
export class SkillHubTeamController {
  constructor(private readonly teams: SkillHubTeamService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Req() request: AuthenticatedUserRequest, @Query() query: Record<string, unknown>) {
    const parsed = skillHubTeamQuerySchema.safeParse({
      ...query,
      limit: typeof query.limit === "string" && /^\d{1,3}$/.test(query.limit) ? Number(query.limit) : query.limit,
    })
    if (!parsed.success) throw hubError(400, "HUB_INVALID_INPUT", "团队分页参数无效。")
    return this.teams.listForUser(request.user!.id, parsed.data)
  }
}
