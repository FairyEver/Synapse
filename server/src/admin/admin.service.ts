import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common"
import { Prisma, type UserStatus } from "@prisma/client"
import { AuditLogService } from "../common/audit-log.service"
import { InvitationsService } from "../invitations/invitations.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PermissionsService } from "../permissions/permissions.service"
import { PrismaService } from "../prisma/prisma.service"

type AdminPrismaClient = PrismaService | Prisma.TransactionClient

const adminUserSelect = {
  id: true,
  email: true,
  status: true,
  memberships: {
    select: {
      id: true,
      role: true,
      createdAt: true,
      team: { select: { id: true, name: true } },
    },
  },
  modulePermissions: {
    select: { permissionKey: true },
    orderBy: { permissionKey: "asc" },
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
      id: true,
      role: true,
      createdAt: true,
      user: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
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
      userModulePermissions,
    ] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
      this.prisma.user.count(),
      this.prisma.team.count(),
      this.prisma.invitation.count(),
      this.prisma.userModulePermission.count(),
    ])

    return {
      serverTime: new Date().toISOString(),
      counts: {
        auditLogs,
        users,
        teams,
        invitations,
        userModulePermissions,
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
    const uniqueIds = [...new Set(ids)]
    const existingCount = await this.prisma.invitation.count({
      where: { id: { in: uniqueIds } },
    })
    if (existingCount !== uniqueIds.length) {
      throw new NotFoundException("邀请不存在。")
    }
    const result = await this.prisma.invitation.deleteMany({
      where: { id: { in: uniqueIds } },
    })
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "admin.invitation.delete_many",
      targetType: "invitation",
      targetId: `batch:${result.count}`,
      detail: { ids: uniqueIds, count: result.count },
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

    const updateUser = (client: AdminPrismaClient) => client.user.update({
      where: { id },
      data: { status: input.status },
      select: adminUserSelect,
    })

    const user = await (input.status === "disabled" && existing.status !== "disabled"
      ? this.prisma.$transaction(async (tx) => {
        await this.assertCanDisableUser(id, tx)
        return updateUser(tx)
      })
      : updateUser(this.prisma)
    ).catch((error: unknown) => {
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

  private async assertCanDisableUser(userId: string, client: AdminPrismaClient): Promise<void> {
    const ownerships = await client.teamMembership.findMany({
      where: {
        userId,
        role: "owner",
      },
      select: { teamId: true },
      orderBy: { teamId: "asc" },
    })
    for (const ownership of ownerships) {
      await client.$executeRaw`SELECT id FROM "Team" WHERE id = ${ownership.teamId} FOR UPDATE`
      const otherActiveOwner = await client.teamMembership.findFirst({
        where: {
          teamId: ownership.teamId,
          userId: { not: userId },
          role: "owner",
          user: { status: "active" },
        },
        select: { id: true },
      })
      if (!otherActiveOwner) throw new BadRequestException("不能停用团队唯一所有者。")
    }
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

  listModulePermissions() {
    return this.permissions.listModulePermissionDefinitions()
  }

  async listUserModulePermissions(userId: string) {
    await this.assertUserExists(userId)
    return { permissionKeys: await this.permissions.listUserModulePermissions(userId) }
  }

  async replaceUserModulePermissions(
    userId: string,
    permissionKeys: readonly string[],
    admin: { readonly id: string; readonly email: string },
    ipAddress = "system",
  ) {
    await this.assertUserExists(userId)
    const result = await this.permissions.replaceUserModulePermissions({
      userId,
      permissionKeys,
      grantedByAdminId: admin.id,
    })
    await this.auditLog?.record({
      adminEmail: admin.email,
      action: "admin.user_module_permissions.replace",
      targetType: "user",
      targetId: userId,
      detail: result,
      ipAddress,
    })
    return { permissionKeys: result.after }
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    })
    if (!user) throw new NotFoundException("用户不存在。")
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
