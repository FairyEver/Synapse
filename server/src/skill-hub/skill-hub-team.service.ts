import { Injectable } from "@nestjs/common"
import { skillHubIdSchema, type SkillHubTeam, type SkillHubTeamPage, type SkillHubTeamQuery } from "@synapse/shared/skill-hub-contracts"
import { decodeHubCursor, encodeHubCursor } from "./skill-hub-cursor"
import { hubError } from "./skill-hub-error"
import { hubPageLimit, SkillHubRepository } from "./skill-hub.repository"

@Injectable()
export class SkillHubTeamService {
  constructor(private readonly repository: SkillHubRepository) {}

  async listForUser(userId: string, { cursor, limit }: SkillHubTeamQuery): Promise<SkillHubTeamPage> {
    const scope = `teams:${userId}`
    const after = cursor ? decodeHubCursor(scope, cursor, skillHubIdSchema) : undefined
    const pageLimit = hubPageLimit(limit)
    const { first, page } = await this.repository.listUserTeams(userId, after, pageLimit)
    const items = page.slice(0, pageLimit)
    return {
      items,
      nextCursor: page.length > pageLimit ? encodeHubCursor(scope, items[items.length - 1].id) : null,
      selectionState: first.length > 1 ? "multiple" : first.length === 1 ? "single" : "none",
      defaultTeamId: first.length === 1 ? first[0].id : null,
    }
  }

  async resolveUploadTeam(userId: string, requestedTeamId?: string): Promise<SkillHubTeam> {
    const teams = await this.repository.findUploadTeams(userId, requestedTeamId)
    if (!teams.length) {
      throw requestedTeamId
        ? hubError(403, "HUB_TEAM_UNAVAILABLE", "你已无法向该团队上传 Skill。")
        : hubError(403, "HUB_NO_TEAM", "加入团队后才能上传 Skill。")
    }
    if (teams.length > 1) throw hubError(400, "HUB_TEAM_REQUIRED", "请选择要上传到的团队。")
    return teams[0]
  }
}
