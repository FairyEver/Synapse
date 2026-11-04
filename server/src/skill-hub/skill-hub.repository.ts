import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { SKILL_HUB_LIMITS, type SkillHubTeam } from "@synapse/shared/skill-hub-contracts"
import { PrismaService } from "../prisma/prisma.service"

function activeMember(userId: string): Prisma.TeamMembershipWhereInput {
  return { userId, user: { status: "active" } }
}

@Injectable()
export class SkillHubRepository {
  constructor(readonly prisma: PrismaService) {}

  private teams(db: Prisma.TransactionClient, userId: string, where: Prisma.TeamMembershipWhereInput, take: number) {
    return db.teamMembership.findMany({
      where: { ...where, ...activeMember(userId) },
      orderBy: { teamId: "asc" },
      select: { team: { select: { id: true, name: true } } },
      take,
    })
  }

  listUserTeams(userId: string, after: string | undefined, limit: number) {
    return this.prisma.$transaction(async (tx) => {
      const first = await this.teams(tx, userId, {}, after ? 2 : Math.max(2, limit + 1))
      const page = !first.length ? [] : after
        ? await this.teams(tx, userId, { teamId: { gt: after } }, limit + 1)
        : first
      return { first: first.slice(0, 2).map(({ team }) => team), page: page.slice(0, limit + 1).map(({ team }) => team) }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  }

  async findUploadTeams(userId: string, requestedTeamId?: string): Promise<SkillHubTeam[]> {
    return (await this.teams(this.prisma, userId, requestedTeamId ? { teamId: requestedTeamId } : {}, requestedTeamId ? 1 : 2))
      .map(({ team }) => team)
  }
}

export function hubPageLimit(limit?: number): number {
  return Math.min(SKILL_HUB_LIMITS.maxPageSize, Math.max(1, limit ?? SKILL_HUB_LIMITS.defaultPageSize))
}
