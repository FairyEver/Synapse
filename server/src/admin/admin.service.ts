import { Injectable, Optional } from "@nestjs/common"
import type { UserStatus } from "@prisma/client"
import { AuditLogService } from "../common/audit-log.service"
import { InvitationsService } from "../invitations/invitations.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"

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

  async listUsers(pagination?: PaginationQuery): Promise<PaginatedResponse<unknown>> {
    const page = pagination ?? parsePagination({})
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        ...toPrismaArgs(page),
        include: {
          memberships: {
            include: { team: { select: { id: true, name: true } } },
          },
        },
      }),
      this.prisma.user.count(),
    ])
    return { data, total, page: page.page, pageSize: page.pageSize }
  }

  async updateUserStatus(id: string, input: { status: UserStatus }, actorEmail = "system") {
    const user = await this.prisma.user.update({
      where: { id },
      data: { status: input.status },
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
        include: {
          acceptedByUser: { select: { email: true } },
          createdByAdmin: { select: { email: true } },
          createdByUser: { select: { email: true } },
          team: { select: { name: true } },
        },
      }),
      this.prisma.invitation.count(),
    ])
    return { data, total, page: page.page, pageSize: page.pageSize }
  }
}
