import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import { InvitationsService } from "../invitations/invitations.service"
import { PrismaService } from "../prisma/prisma.service"

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
  ) {}

  async createTeam(userId: string, input: { name: string }) {
    const existing = await this.getMembership(userId)
    if (existing) throw new BadRequestException("账号已属于一个团队。")

    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { name: input.name.trim(), createdByUserId: userId },
      })
      await tx.teamMembership.create({
        data: { teamId: team.id, userId, role: "owner" },
      })
      return team
    })
  }

  getMyTeam(userId: string) {
    return this.prisma.teamMembership.findUnique({
      where: { userId },
      include: {
        team: {
          include: {
            memberships: {
              include: { user: { select: { id: true, email: true, status: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    })
  }

  async createInvitation(userId: string) {
    const membership = await this.getMembership(userId)
    if (!membership || membership.role !== "owner") {
      throw new ForbiddenException()
    }
    return this.invitations.createTeamInvitation({ userId, teamId: membership.teamId })
  }

  async joinTeam(userId: string, input: { invitationToken: string }) {
    const existing = await this.getMembership(userId)
    if (existing) throw new BadRequestException("账号已属于一个团队。")

    return this.prisma.$transaction(async (tx) => {
      const invitation = await this.invitations.consumeInvitation({
        token: input.invitationToken,
        type: "team_join",
        acceptedByUserId: userId,
      }, tx)
      if (!invitation.teamId) throw new BadRequestException("邀请无效或已过期。")
      return tx.teamMembership.create({
        data: { teamId: invitation.teamId, userId, role: "member" },
      })
    })
  }

  async listMembers(userId: string) {
    const membership = await this.getMembership(userId)
    if (!membership) throw new ForbiddenException()
    return this.prisma.teamMembership.findMany({
      where: { teamId: membership.teamId },
      include: { user: { select: { id: true, email: true, status: true } } },
      orderBy: { createdAt: "asc" },
    })
  }

  async removeMember(ownerUserId: string, targetUserId: string) {
    const ownerMembership = await this.getMembership(ownerUserId)
    if (!ownerMembership || ownerMembership.role !== "owner") {
      throw new ForbiddenException()
    }
    if (ownerUserId === targetUserId) {
      throw new BadRequestException("不能移除团队所有者。")
    }

    const targetMembership = await this.prisma.teamMembership.findUnique({ where: { userId: targetUserId } })
    if (!targetMembership || targetMembership.teamId !== ownerMembership.teamId || targetMembership.role === "owner") {
      throw new BadRequestException("成员不存在。")
    }

    await this.prisma.teamMembership.delete({ where: { userId: targetUserId } })
    return { ok: true }
  }

  private getMembership(userId: string) {
    return this.prisma.teamMembership.findUnique({
      where: { userId },
      include: { team: true },
    })
  }
}
