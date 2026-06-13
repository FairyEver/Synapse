import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common"
import { Prisma, type UserStatus } from "@prisma/client"
import { PinoLogger } from "nestjs-pino"
import { createOpaqueToken, hashToken } from "../auth/token"
import { AuditLogService } from "../common/audit-log.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { buildTeamInviteUrl } from "../invitations/invitation-url"
import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { PrismaService } from "../prisma/prisma.service"

type AdminPrismaClient = PrismaService | Prisma.TransactionClient
type AuditRecordInput = Parameters<AuditLogService["record"]>[0]
const invitationDays = 7

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

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + days)
  return next
}

function formatDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, "0")
  const date = `${value.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${date}`
}

function buildDailyTrend(
  now: Date,
  values: ReadonlyArray<{ readonly createdAt: Date }>,
): Array<{ date: string; label: string; count: number }> {
  const today = startOfDay(now)
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6)
    const key = formatDateKey(date)
    return {
      key,
      date: key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      count: 0,
    }
  })
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))

  for (const value of values) {
    const key = formatDateKey(startOfDay(value.createdAt))
    const bucket = bucketByKey.get(key)
    if (bucket) bucket.count += 1
  }

  return buckets.map(({ key: _key, ...bucket }) => bucket)
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly liveDesktopGateway?: LiveDesktopGateway,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  async getSystemOverview() {
    const now = new Date()
    const windowStart = startOfDay(addDays(now, -6))
    const [
      auditLogs,
      users,
      teams,
      invitations,
      activeUsers,
      disabledUsers,
      pendingInvitations,
      usedInvitations,
      expiredInvitations,
      recentUsers,
      recentTeams,
      recentInvitations,
      recentAuditLogs,
    ] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
      this.prisma.user.count(),
      this.prisma.team.count(),
      this.prisma.invitation.count(),
      this.prisma.user.count({ where: { status: "active" } }),
      this.prisma.user.count({ where: { status: "disabled" } }),
      this.prisma.invitation.count({ where: { usedAt: null, expiresAt: { gt: now } } }),
      this.prisma.invitation.count({ where: { usedAt: { not: null } } }),
      this.prisma.invitation.count({ where: { usedAt: null, expiresAt: { lte: now } } }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
      this.prisma.team.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
      this.prisma.invitation.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
    ])

    const userTrend = buildDailyTrend(now, recentUsers)
    const teamTrend = buildDailyTrend(now, recentTeams)
    const invitationTrend = buildDailyTrend(now, recentInvitations)
    const auditLogTrend = buildDailyTrend(now, recentAuditLogs)

    return {
      serverTime: now.toISOString(),
      counts: {
        auditLogs,
        users,
        teams,
        invitations,
      },
      userStatus: {
        active: activeUsers,
        disabled: disabledUsers,
      },
      invitationStatus: {
        pending: pendingInvitations,
        used: usedInvitations,
        expired: expiredInvitations,
      },
      dailyTrend: userTrend.map((item, index) => ({
        date: item.date,
        label: item.label,
        users: item.count,
        teams: teamTrend[index]?.count ?? 0,
        invitations: invitationTrend[index]?.count ?? 0,
        auditLogs: auditLogTrend[index]?.count ?? 0,
      })),
    }
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
    await this.recordServiceManagedAuditSafely({
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
    const result = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.invitation.deleteMany({
        where: { id: { in: uniqueIds } },
      })
      if (deleted.count !== uniqueIds.length) {
        throw new NotFoundException("邀请不存在。")
      }
      return deleted
    })
    await this.recordServiceManagedAuditSafely({
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
    if (input.status === "disabled") {
      this.liveDesktopGateway?.disconnectUser(id)
    }
    await this.recordServiceManagedAuditSafely({
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

  async createInvitation(
    input: { readonly teamId: string },
    admin: { readonly id: string; readonly email: string },
    publicAppUrl: string,
    ipAddress = "system",
  ) {
    const team = await this.prisma.team.findUnique({
      where: { id: input.teamId },
      select: { id: true },
    })
    if (!team) throw new NotFoundException("团队不存在。")

    const token = createOpaqueToken()
    const inviteUrl = buildTeamInviteUrl({ publicAppUrl, token })
    const invitation = await this.prisma.invitation.create({
      data: {
        type: "team_join",
        tokenHash: hashToken(token),
        inviteUrl,
        expiresAt: addDays(new Date(), invitationDays),
        createdByAdminId: admin.id,
        teamId: input.teamId,
      },
    })
    await this.recordServiceManagedAuditSafely({
      adminEmail: admin.email,
      action: "admin.invitation.create",
      targetType: "invitation",
      targetId: invitation.id,
      detail: { teamId: input.teamId },
      ipAddress,
    })
    return {
      id: invitation.id,
      token,
      inviteUrl,
      expiresAt: invitation.expiresAt,
    }
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

  private async recordServiceManagedAuditSafely(input: AuditRecordInput): Promise<void> {
    try {
      await this.auditLog?.record(input)
    } catch (error) {
      this.logger?.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ...auditWriteErrorMetadata(error),
      }, "Failed to record admin service audit log")
    }
  }
}

function auditWriteErrorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}
