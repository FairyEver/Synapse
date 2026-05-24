import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common"
import { Prisma, type UserStatus } from "@prisma/client"
import { AuditLogService } from "../common/audit-log.service"
import { InvitationsService } from "../invitations/invitations.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PermissionsService } from "../permissions/permissions.service"
import { PrismaService } from "../prisma/prisma.service"

const adminUserSelect = {
  id: true,
  email: true,
  status: true,
  memberships: {
    select: {
      role: true,
      team: { select: { id: true, name: true } },
      accessRoles: {
        select: { role: { select: { id: true, name: true } } },
        orderBy: { assignedAt: "asc" },
      },
    },
  },
  createdAt: true,
  updatedAt: true,
} as const

const adminTeamSelect = {
  id: true,
  name: true,
  createdByUser: { select: { email: true } },
  memberships: {
    select: {
      role: true,
      createdAt: true,
      user: { select: { email: true } },
      accessRoles: {
        select: { role: { select: { id: true, name: true } } },
        orderBy: { assignedAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  createdAt: true,
  updatedAt: true,
} as const

const adminTeamAccessRoleSelect = {
  id: true,
  name: true,
  description: true,
  kind: true,
  locked: true,
  sortOrder: true,
  permissions: {
    select: { permissionKey: true },
    orderBy: { permissionKey: "asc" },
  },
  createdAt: true,
  updatedAt: true,
} as const

function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025"
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly permissions: PermissionsService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async getSystemOverview() {
    const [
      auditLogs,
      users,
      teams,
      invitations,
      teamEntitlements,
      teamAccessRoles,
      teamAccessRolePermissions,
      teamMemberAccessRoles,
    ] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
      this.prisma.user.count(),
      this.prisma.team.count(),
      this.prisma.invitation.count(),
      this.prisma.teamEntitlement.count(),
      this.prisma.teamAccessRole.count(),
      this.prisma.teamAccessRolePermission.count(),
      this.prisma.teamMemberAccessRole.count(),
    ])

    return {
      serverTime: new Date().toISOString(),
      counts: {
        auditLogs,
        users,
        teams,
        invitations,
        teamEntitlements,
        teamAccessRoles,
        teamAccessRolePermissions,
        teamMemberAccessRoles,
      },
    }
  }

  async createSignupInvitation(admin: { readonly id: string; readonly email: string }, publicAppUrl: string, ipAddress = "system") {
    const invitation = await this.invitations.createSignupInvitation({ adminId: admin.id, publicAppUrl })
    await this.auditLog?.record({
      adminEmail: admin.email,
      action: "admin.invitation.create",
      targetType: "invitation",
      targetId: invitation.id,
      ipAddress,
    })
    return invitation
  }

  async deleteInvitation(id: string, actorEmail = "system", ipAddress = "system") {
    try {
      await this.prisma.invitation.delete({ where: { id } })
    } catch (error: unknown) {
      if (isRecordNotFoundError(error)) {
        await this.auditLog?.record({
          adminEmail: actorEmail,
          action: "admin.invitation.delete.not_found",
          targetType: "invitation",
          targetId: id,
          ipAddress,
        })
        throw new NotFoundException("邀请不存在。")
      }
      throw error
    }
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "admin.invitation.delete",
      targetType: "invitation",
      targetId: id,
      ipAddress,
    })
    return { ok: true }
  }

  async deleteInvitations(ids: readonly string[], actorEmail = "system", ipAddress = "system") {
    const result = await this.prisma.invitation.deleteMany({
      where: { id: { in: [...ids] } },
    })
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "admin.invitation.delete_many",
      targetType: "invitation",
      targetId: `batch:${result.count}`,
      detail: { ids: [...ids], count: result.count },
      ipAddress,
    })
    return { ok: true, count: result.count }
  }

  async listUsers(pagination?: PaginationQuery): Promise<PaginatedResponse<unknown>> {
    const page = pagination ?? parsePagination({})
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        ...toPrismaArgs(page),
        select: adminUserSelect,
      }),
      this.prisma.user.count(),
    ])
    return { data, total, page: page.page, pageSize: page.pageSize }
  }

  async updateUserStatus(id: string, input: { status: UserStatus }, actorEmail = "system", ipAddress = "system") {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!existing) throw new NotFoundException("用户不存在。")
    if (input.status === "disabled" && existing.status !== "disabled") {
      await this.assertCanDisableUser(id)
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { status: input.status },
      select: adminUserSelect,
    }).catch((error: unknown) => {
      if (isRecordNotFoundError(error)) throw new NotFoundException("用户不存在。")
      throw error
    })
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "admin.user.status_update",
      targetType: "user",
      targetId: id,
      detail: { status: input.status },
      ipAddress,
    })
    return user
  }

  private async assertCanDisableUser(userId: string): Promise<void> {
    const blockingOwnership = await this.prisma.teamMembership.findFirst({
      where: {
        userId,
        role: "owner",
        team: {
          memberships: {
            none: {
              userId: { not: userId },
              role: "owner",
              user: { status: "active" },
            },
          },
        },
      },
      select: { team: { select: { id: true } } },
    })
    if (blockingOwnership) throw new BadRequestException("不能停用团队唯一所有者。")
  }

  async listTeams(pagination?: PaginationQuery): Promise<PaginatedResponse<unknown>> {
    const page = pagination ?? parsePagination({})
    const [data, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        ...toPrismaArgs(page),
        select: adminTeamSelect,
      }),
      this.prisma.team.count(),
    ])
    return { data, total, page: page.page, pageSize: page.pageSize }
  }

  listPermissions() {
    return this.permissions.listPermissionDefinitions()
  }

  async listTeamEntitlements(teamId: string) {
    await this.assertTeamExists(teamId)
    return { permissionKeys: await this.permissions.listTeamEntitlements(teamId) }
  }

  async replaceTeamEntitlements(
    teamId: string,
    permissionKeys: readonly string[],
    admin: { readonly id: string; readonly email: string },
    ipAddress = "system",
  ) {
    await this.assertTeamExists(teamId)
    const next = await this.permissions.replaceTeamEntitlements({
      teamId,
      permissionKeys,
      grantedByAdminId: admin.id,
      source: "manual",
    })
    await this.auditLog?.record({
      adminEmail: admin.email,
      action: "admin.team_entitlements.update",
      targetType: "team",
      targetId: teamId,
      detail: { permissionKeys: next },
      ipAddress,
    })
    return { permissionKeys: next }
  }

  async listTeamAccessRoles(teamId: string) {
    await this.assertTeamExists(teamId)
    const roles = await this.prisma.teamAccessRole.findMany({
      where: { teamId },
      select: adminTeamAccessRoleSelect,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    return roles.map(({ permissions, ...role }) => ({
      ...role,
      permissionKeys: permissions.map((permission) => permission.permissionKey),
    }))
  }

  async replaceRolePermissions(
    teamId: string,
    roleId: string,
    permissionKeys: readonly string[],
    admin: { readonly id: string; readonly email: string },
    ipAddress = "system",
  ) {
    await this.assertTeamExists(teamId)
    const next = await this.permissions.replaceRolePermissions({ teamId, roleId, permissionKeys })
    await this.auditLog?.record({
      adminEmail: admin.email,
      action: "admin.team_role_permissions.update",
      targetType: "team_access_role",
      targetId: roleId,
      detail: { teamId, permissionKeys: next },
      ipAddress,
    })
    return { permissionKeys: next }
  }

  private async assertTeamExists(teamId: string): Promise<void> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true },
    })
    if (!team) throw new NotFoundException("团队不存在。")
  }

  async listInvitations(pagination?: PaginationQuery): Promise<PaginatedResponse<unknown>> {
    const page = pagination ?? parsePagination({})
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invitation.findMany({
        ...toPrismaArgs(page),
        select: {
          id: true,
          type: true,
          inviteUrl: true,
          expiresAt: true,
          usedAt: true,
          acceptedByUser: { select: { email: true } },
          createdByAdmin: { select: { email: true } },
          createdByUser: { select: { email: true } },
          createdAt: true,
          team: { select: { name: true } },
        },
      }),
      this.prisma.invitation.count(),
    ])
    return { data, total, page: page.page, pageSize: page.pageSize }
  }
}
