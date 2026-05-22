import { Injectable, NotFoundException, Optional } from "@nestjs/common"
import { Prisma, type UserStatus } from "@prisma/client"
import { AuditLogService } from "../common/audit-log.service"
import { InvitationsService } from "../invitations/invitations.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"

const adminUserSelect = {
  id: true,
  email: true,
  status: true,
  memberships: {
    select: {
      role: true,
      team: { select: { id: true, name: true } },
    },
  },
  createdAt: true,
} as const

function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025"
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async getSystemOverview() {
    const [auditLogs, users, teams, invitations] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
      this.prisma.user.count(),
      this.prisma.team.count(),
      this.prisma.invitation.count({ where: { type: "user_signup" } }),
    ])

    return {
      serverTime: new Date().toISOString(),
      counts: {
        auditLogs,
        users,
        teams,
        invitations,
      },
    }
  }

  async createSignupInvitation(admin: { readonly id: string; readonly email: string }, publicAppUrl: string) {
    const invitation = await this.invitations.createSignupInvitation({ adminId: admin.id, publicAppUrl })
    await this.auditLog?.record({
      adminEmail: admin.email,
      action: "admin.invitation.create",
      targetType: "invitation",
      targetId: invitation.id,
      ipAddress: "system",
    })
    return invitation
  }

  async deleteInvitation(id: string, actorEmail = "system") {
    await this.prisma.invitation.delete({ where: { id } }).catch((error: unknown) => {
      if (isRecordNotFoundError(error)) throw new NotFoundException("邀请不存在。")
      throw error
    })
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "admin.invitation.delete",
      targetType: "invitation",
      targetId: id,
      ipAddress: "system",
    })
    return { ok: true }
  }

  async deleteInvitations(ids: readonly string[], actorEmail = "system") {
    const result = await this.prisma.invitation.deleteMany({
      where: { id: { in: [...ids] } },
    })
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: "admin.invitation.delete_many",
      targetType: "invitation",
      targetId: ids.join(","),
      detail: { ids: [...ids], count: result.count },
      ipAddress: "system",
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

  async updateUserStatus(id: string, input: { status: UserStatus }, actorEmail = "system") {
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
      ipAddress: "system",
    })
    return user
  }

  async listTeams(pagination?: PaginationQuery): Promise<PaginatedResponse<unknown>> {
    const page = pagination ?? parsePagination({})
    const [data, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        ...toPrismaArgs(page),
        include: {
          createdByUser: { select: { email: true } },
          memberships: {
            include: { user: { select: { email: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      this.prisma.team.count(),
    ])
    return { data, total, page: page.page, pageSize: page.pageSize }
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
