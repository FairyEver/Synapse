import { BadRequestException, ForbiddenException, Injectable, Optional } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { AuditLogService } from "../common/audit-log.service"
import { InvitationsService } from "../invitations/invitations.service"
import { PermissionsService } from "../permissions/permissions.service"
import { PrismaService } from "../prisma/prisma.service"

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly permissions: PermissionsService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async createTeam(userId: string, input: { name: string }, ipAddress = "system") {
    const existing = await this.getMembership(userId)
    if (existing) {
      await this.recordTeamFailure({
        actorUserId: userId,
        action: "team.create.failure",
        targetType: "team",
        targetId: "unknown",
        reason: "already_in_team",
        ipAddress,
      })
      throw new BadRequestException("账号已属于一个团队。")
    }

    const team = await this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { name: input.name.trim(), createdByUserId: userId },
      })
      const membership = await tx.teamMembership.create({
        data: { teamId: team.id, userId, role: "owner" },
      })
      await this.permissions.ensureDefaultTeamAccess({
        teamId: team.id,
        ownerMembershipId: membership.id,
        ownerUserId: userId,
        client: tx,
      })
      return team
    }).catch(async (error: unknown) => {
      if (isUniqueConstraintError(error)) {
        await this.recordTeamFailure({
          actorUserId: userId,
          action: "team.create.failure",
          targetType: "team",
          targetId: "unknown",
          reason: "already_in_team",
          ipAddress,
        })
        throw new BadRequestException("账号已属于一个团队。")
      }
      throw error
    })
    const actorEmail = await this.getAuditActorEmail(userId)
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "team.create",
      targetType: "team",
      targetId: team.id,
      ipAddress,
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
              include: {
                user: { select: { id: true, email: true, status: true } },
                accessRoles: {
                  select: { role: { select: { id: true, name: true } } },
                  orderBy: { assignedAt: "asc" },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    })
  }

  async createInvitation(userId: string, publicAppUrl: string, ipAddress = "system") {
    const membership = await this.requireTeamPermission(userId, "team.invitation.manage")
    const invitation = await this.invitations.createTeamInvitation({ userId, teamId: membership.teamId, publicAppUrl })
    const actorEmail = await this.getAuditActorEmail(userId)
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "team.invitation.create",
      targetType: "invitation",
      targetId: invitation.id,
      ipAddress,
    })
    return invitation
  }

  async joinTeam(userId: string, input: { invitationToken: string }, ipAddress = "system") {
    const existing = await this.getMembership(userId)
    if (existing) {
      await this.recordTeamFailure({
        actorUserId: userId,
        action: "team.join.failure",
        targetType: "team",
        targetId: "unknown",
        reason: "already_in_team",
        ipAddress,
      })
      throw new BadRequestException("账号已属于一个团队。")
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const invitation = await this.invitations.consumeInvitation({
        token: input.invitationToken,
        type: "team_join",
        acceptedByUserId: userId,
      }, tx)
      if (!invitation.teamId) throw new BadRequestException("邀请无效或已过期。")
      const membership = await tx.teamMembership.create({
        data: { teamId: invitation.teamId, userId, role: "member" },
        include: {
          user: { select: { id: true, email: true, status: true } },
          accessRoles: {
            select: { role: { select: { id: true, name: true } } },
            orderBy: { assignedAt: "asc" },
          },
        },
      })
      await this.permissions.assignOrdinaryMemberRole({
        teamId: invitation.teamId,
        teamMembershipId: membership.id,
        assignedByUserId: userId,
        client: tx,
      })
      return { membership, teamId: invitation.teamId }
    }).catch(async (error: unknown) => {
      if (isUniqueConstraintError(error)) {
        await this.recordTeamFailure({
          actorUserId: userId,
          action: "team.join.failure",
          targetType: "team",
          targetId: "unknown",
          reason: "already_in_team",
          ipAddress,
        })
        throw new BadRequestException("账号已属于一个团队。")
      }
      if (isBadRequestMessage(error, "邀请无效或已过期。")) {
        await this.recordTeamFailure({
          actorUserId: userId,
          action: "team.join.failure",
          targetType: "team",
          targetId: "unknown",
          reason: "invalid_invitation",
          ipAddress,
        })
      }
      throw error
    })
    const actorEmail = await this.getAuditActorEmail(userId)
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "team.join",
      targetType: "team",
      targetId: result.teamId,
      ipAddress,
    })
    return result.membership
  }

  async listMembers(userId: string) {
    const membership = await this.getMembership(userId)
    if (!membership) throw new ForbiddenException()
    return this.prisma.teamMembership.findMany({
      where: { teamId: membership.teamId },
      include: {
        user: { select: { id: true, email: true, status: true } },
        accessRoles: {
          select: { role: { select: { id: true, name: true } } },
          orderBy: { assignedAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    })
  }

  async removeMember(actorUserId: string, targetUserId: string, ipAddress = "system") {
    let actorMembership: NonNullable<Awaited<ReturnType<typeof this.getMembership>>>
    try {
      actorMembership = await this.requireTeamPermission(actorUserId, "team.member.manage")
    } catch (error) {
      if (error instanceof ForbiddenException) {
        await this.recordTeamFailure({
          actorUserId,
          action: "team.member.remove.failure",
          targetType: "user",
          targetId: targetUserId,
          reason: "permission_denied",
          ipAddress,
        })
      }
      throw error
    }
    if (actorUserId === targetUserId) {
      await this.recordTeamFailure({
        actorUserId,
        action: "team.member.remove.failure",
        targetType: "user",
        targetId: targetUserId,
        reason: "self_remove",
        detail: { teamId: actorMembership.teamId },
        ipAddress,
      })
      throw new BadRequestException("不能移除自己。")
    }

    const targetMembership = await this.prisma.teamMembership.findUnique({ where: { userId: targetUserId } })
    if (!targetMembership || targetMembership.teamId !== actorMembership.teamId) {
      await this.recordTeamFailure({
        actorUserId,
        action: "team.member.remove.failure",
        targetType: "user",
        targetId: targetUserId,
        reason: "target_not_found",
        detail: { teamId: actorMembership.teamId },
        ipAddress,
      })
      throw new BadRequestException("成员不存在。")
    }
    if (targetMembership.role === "owner") {
      await this.recordTeamFailure({
        actorUserId,
        action: "team.member.remove.failure",
        targetType: "user",
        targetId: targetUserId,
        reason: "target_is_owner",
        detail: { teamId: actorMembership.teamId },
        ipAddress,
      })
      throw new BadRequestException("不能移除团队所有者。")
    }

    const deletedMembership = await this.prisma.teamMembership.deleteMany({
      where: { userId: targetUserId, teamId: actorMembership.teamId },
    })
    if (deletedMembership.count === 0) {
      await this.recordTeamFailure({
        actorUserId,
        action: "team.member.remove.failure",
        targetType: "user",
        targetId: targetUserId,
        reason: "target_not_found",
        detail: { teamId: actorMembership.teamId },
        ipAddress,
      })
      throw new BadRequestException("成员不存在。")
    }
    const actorEmail = await this.getAuditActorEmail(actorUserId)
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "team.member.remove",
      targetType: "user",
      targetId: targetUserId,
      detail: { teamId: actorMembership.teamId },
      ipAddress,
    })
    return { ok: true }
  }

  async leaveTeam(userId: string, ipAddress = "system") {
    const membership = await this.getMembership(userId)
    if (!membership) throw new BadRequestException("账号未加入团队。")
    let dissolved = false

    if (membership.role === "owner") {
      await this.prisma.$transaction(async (tx) => {
        await this.lockTeamForMembershipChange(tx, membership.teamId)
        const memberCount = await tx.teamMembership.count({ where: { teamId: membership.teamId } })
        if (memberCount > 1) {
          throw new BadRequestException("请先移除其他成员。")
        }
        const deletedMembership = await tx.teamMembership.deleteMany({ where: { userId, teamId: membership.teamId } })
        if (deletedMembership.count === 0) {
          throw new BadRequestException("账号未加入团队。")
        }
        await tx.invitation.deleteMany({ where: { teamId: membership.teamId } })
        const deletedTeam = await tx.team.deleteMany({ where: { id: membership.teamId } })
        if (deletedTeam.count === 0) {
          throw new BadRequestException("团队已解散。")
        }
      })
      dissolved = true
    } else {
      const deletedMembership = await this.prisma.teamMembership.deleteMany({ where: { userId, teamId: membership.teamId } })
      if (deletedMembership.count === 0) {
        throw new BadRequestException("账号未加入团队。")
      }
    }

    const actorEmail = await this.getAuditActorEmail(userId)
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: dissolved ? "team.dissolve" : "team.leave",
      targetType: "team",
      targetId: membership.teamId,
      detail: { teamId: membership.teamId, dissolved },
      ipAddress,
    })
    return { ok: true }
  }

  private getMembership(userId: string) {
    return this.prisma.teamMembership.findUnique({
      where: { userId },
      include: { team: true },
    })
  }

  private async requireTeamPermission(userId: string, permissionKey: string) {
    const membership = await this.getMembership(userId)
    if (!membership) throw new ForbiddenException()
    const permissionKeys = await this.permissions.getEffectivePermissions(userId, membership.teamId)
    if (!permissionKeys.includes(permissionKey)) throw new ForbiddenException()
    return membership
  }

  private async lockTeamForMembershipChange(tx: Prisma.TransactionClient, teamId: string): Promise<void> {
    await tx.$executeRaw`SELECT id FROM "Team" WHERE id = ${teamId} FOR UPDATE`
  }

  private async getAuditActorEmail(userId: string): Promise<string> {
    if (!this.auditLog) return userId
    try {
      return await this.getUserEmail(userId)
    } catch {
      return userId
    }
  }

  private async getUserEmail(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    return user?.email ?? userId
  }

  private async recordTeamFailure(input: {
    readonly actorUserId: string
    readonly action: "team.create.failure" | "team.join.failure" | "team.member.remove.failure"
    readonly targetType: "team" | "user"
    readonly targetId: string
    readonly reason: string
    readonly detail?: Record<string, unknown>
    readonly ipAddress: string
  }): Promise<void> {
    const actorEmail = await this.getAuditActorEmail(input.actorUserId)
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: { ...input.detail, reason: input.reason },
      ipAddress: input.ipAddress,
    })
  }
}

function isBadRequestMessage(error: unknown, message: string): boolean {
  if (!(error instanceof BadRequestException)) return false
  const response = error.getResponse()
  if (typeof response === "string") return response === message
  return Boolean(response && typeof response === "object" && "message" in response && (response as { message: unknown }).message === message)
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
