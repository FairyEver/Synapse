import { BadRequestException, ForbiddenException, Injectable, Optional } from "@nestjs/common"
import { AuditLogService } from "../common/audit-log.service"
import { InvitationsService } from "../invitations/invitations.service"
import { PrismaService } from "../prisma/prisma.service"

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async createTeam(userId: string, input: { name: string }) {
    const existing = await this.getMembership(userId)
    if (existing) throw new BadRequestException("账号已属于一个团队。")

    const team = await this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { name: input.name.trim(), createdByUserId: userId },
      })
      await tx.teamMembership.create({
        data: { teamId: team.id, userId, role: "owner" },
      })
      return team
    })
    await this.auditLog?.record({
      adminEmail: userId,
      action: "team.create",
      targetType: "team",
      targetId: team.id,
      ipAddress: "system",
    })
    return team
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

  async createInvitation(userId: string, publicAppUrl: string) {
    const membership = await this.getMembership(userId)
    if (!membership || membership.role !== "owner") {
      throw new ForbiddenException()
    }
    const invitation = await this.invitations.createTeamInvitation({ userId, teamId: membership.teamId, publicAppUrl })
    await this.auditLog?.record({
      adminEmail: userId,
      action: "team.invitation.create",
      targetType: "invitation",
      targetId: invitation.id,
      ipAddress: "system",
    })
    return invitation
  }

  async joinTeam(userId: string, input: { invitationToken: string }) {
    const existing = await this.getMembership(userId)
    if (existing) throw new BadRequestException("账号已属于一个团队。")

    const result = await this.prisma.$transaction(async (tx) => {
      const invitation = await this.invitations.consumeInvitation({
        token: input.invitationToken,
        type: "team_join",
        acceptedByUserId: userId,
      }, tx)
      if (!invitation.teamId) throw new BadRequestException("邀请无效或已过期。")
      const membership = await tx.teamMembership.create({
        data: { teamId: invitation.teamId, userId, role: "member" },
      })
      return { membership, teamId: invitation.teamId }
    })
    await this.auditLog?.record({
      adminEmail: userId,
      action: "team.join",
      targetType: "team",
      targetId: result.teamId,
      ipAddress: "system",
    })
    return result.membership
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
    await this.auditLog?.record({
      adminEmail: ownerUserId,
      action: "team.member.remove",
      targetType: "user",
      targetId: targetUserId,
      detail: { teamId: ownerMembership.teamId },
      ipAddress: "system",
    })
    return { ok: true }
  }

  private getMembership(userId: string) {
    return this.prisma.teamMembership.findUnique({
      where: { userId },
      include: { team: true },
    })
  }
}
