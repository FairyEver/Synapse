import { Injectable } from "@nestjs/common"
import type { UserStatus } from "@prisma/client"
import { InvitationsService } from "../invitations/invitations.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
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

  createSignupInvitation(adminId: string) {
    return this.invitations.createSignupInvitation({ adminId })
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

  updateUserStatus(id: string, input: { status: UserStatus }) {
    return this.prisma.user.update({
      where: { id },
      data: { status: input.status },
    })
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
    const where = { type: "user_signup" as const }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invitation.findMany({
        ...toPrismaArgs(page),
        where,
        include: { acceptedByUser: { select: { email: true } } },
      }),
      this.prisma.invitation.count({ where }),
    ])
    return { data, total, page: page.page, pageSize: page.pageSize }
  }
}
