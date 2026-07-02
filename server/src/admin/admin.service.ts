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
type TeamListFilters = {
  readonly search?: string
}
type SkillRepositoryAdminListFilters = {
  readonly status?: "active" | "removed"
  readonly query?: string
}
const invitationDays = 7
export const maxBulkInvitationDeleteIds = 100
const bulkInvitationDeleteAuditSampleSize = 10

const adminUserSelect = {
  id: true,
  email: true,
  displayName: true,
  adminNote: true,
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
  _count: { select: { memberships: true } },
  createdAt: true,
  updatedAt: true,
} as const

const adminSkillRepositorySelect = {
  id: true,
  name: true,
  title: true,
  visibility: true,
  status: true,
  legacyInstallCount: true,
  owner: { select: { id: true, handle: true, displayName: true } },
  updatedAt: true,
} as const

type AdminTeamRecord = Prisma.TeamGetPayload<{ select: typeof adminTeamSelect }>
type AdminSkillRepositoryRecord = Prisma.SkillRepositoryGetPayload<{ select: typeof adminSkillRepositorySelect }>

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

type DailyTrendBucket = {
  readonly date: string
  readonly label: string
  readonly start: Date
  readonly end: Date
}

function buildDailyTrendBuckets(now: Date): DailyTrendBucket[] {
  const today = startOfDay(now)
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(today, index - 6)
    const nextDate = addDays(date, 1)
    const key = formatDateKey(date)
    return {
      date: key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      start: date,
      end: nextDate,
    }
  })
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
    const trendBuckets = buildDailyTrendBuckets(now)
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
      ...dailyTrendCounts
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
      ...trendBuckets.flatMap((bucket) => [
        this.prisma.user.count({ where: { createdAt: { gte: bucket.start, lt: bucket.end } } }),
        this.prisma.team.count({ where: { createdAt: { gte: bucket.start, lt: bucket.end } } }),
        this.prisma.invitation.count({ where: { createdAt: { gte: bucket.start, lt: bucket.end } } }),
        this.prisma.auditLog.count({ where: { createdAt: { gte: bucket.start, lt: bucket.end } } }),
      ]),
    ])

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
      dailyTrend: trendBuckets.map((bucket, index) => ({
        date: bucket.date,
        label: bucket.label,
        users: dailyTrendCounts[index * 4] ?? 0,
        teams: dailyTrendCounts[index * 4 + 1] ?? 0,
        invitations: dailyTrendCounts[index * 4 + 2] ?? 0,
        auditLogs: dailyTrendCounts[index * 4 + 3] ?? 0,
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
    if (uniqueIds.length > maxBulkInvitationDeleteIds) {
      throw new BadRequestException(`一次最多删除 ${maxBulkInvitationDeleteIds} 个邀请。`)
    }
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
      detail: {
        count: result.count,
        ids: uniqueIds.slice(0, bulkInvitationDeleteAuditSampleSize),
        idsTruncated: uniqueIds.length > bulkInvitationDeleteAuditSampleSize,
      },
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

  async updateUserAdminNote(
    id: string,
    input: { readonly adminNote: string | null },
    actorEmail = "system",
    ipAddress = "system",
  ) {
    const adminNote = normalizeAdminNote(input.adminNote)
    const user = await this.prisma.user.update({
      where: { id },
      data: { adminNote },
      select: adminUserSelect,
    }).catch((error: unknown) => {
      if (isRecordNotFoundError(error)) throw new NotFoundException("用户不存在。")
      throw error
    })
    await this.recordServiceManagedAuditSafely({
      adminEmail: actorEmail,
      action: "admin.user.admin_note_update",
      targetType: "user",
      targetId: id,
      detail: {
        hasAdminNote: adminNote !== null,
        adminNoteLength: adminNote?.length ?? 0,
      },
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

  async listTeams(
    pagination?: PaginationQuery,
    filters: TeamListFilters = {},
  ): Promise<PaginatedResponse<unknown>> {
    const page = pagination ?? parsePagination({})
    const search = filters.search?.trim()
    const where = search
      ? {
          name: {
            contains: search,
            mode: "insensitive",
          },
        } satisfies Prisma.TeamWhereInput
      : undefined
    const [data, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        ...toPrismaArgs(page),
        ...(where ? { where } : {}),
        select: adminTeamSelect,
      }),
      this.prisma.team.count(where ? { where } : undefined),
    ])
    return {
      data: data.map(toAdminTeamListRow),
      total,
      page: page.page,
      pageSize: page.pageSize,
    }
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
    const now = new Date()
    const [data, total] = await this.prisma.$transaction([
      this.prisma.invitation.findMany({
        ...toPrismaArgs(page),
        select: {
          id: true,
          type: true,
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
    return {
      data: data.map((invitation) => ({
        ...invitation,
        status: resolveAdminInvitationStatus(invitation, now),
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
    }
  }

  async listSkillRepositories(
    pagination?: PaginationQuery,
    filters: SkillRepositoryAdminListFilters = {},
  ): Promise<PaginatedResponse<unknown>> {
    const page = pagination ?? parsePagination({})
    const query = filters.query?.trim()
    const where: Prisma.SkillRepositoryWhereInput = {
      visibility: "public",
      status: filters.status ?? "active",
      ...(query ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { title: { contains: query, mode: "insensitive" } },
          { owner: { handle: { contains: query, mode: "insensitive" } } },
        ],
      } : {}),
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.skillRepository.findMany({
        ...toPrismaArgs(page),
        where,
        select: adminSkillRepositorySelect,
      }),
      this.prisma.skillRepository.count({ where }),
    ])
    return {
      data: (data as AdminSkillRepositoryRecord[]).map(toAdminSkillRepositoryRow),
      total,
      page: page.page,
      pageSize: page.pageSize,
    }
  }

  async setSkillRepositoryRemoved(id: string, removed: boolean, actorEmail = "system", ipAddress = "system") {
    const repository = await this.prisma.skillRepository.update({
      where: { id },
      data: { status: removed ? "removed" : "active" },
      select: adminSkillRepositorySelect,
    }).catch((error: unknown) => {
      if (isRecordNotFoundError(error)) throw new NotFoundException("Skill 仓库不存在。")
      throw error
    })
    await this.recordServiceManagedAuditSafely({
      adminEmail: actorEmail,
      action: removed ? "admin.skill_repository.remove" : "admin.skill_repository.restore",
      targetType: "skill_repository",
      targetId: id,
      detail: { status: repository.status },
      ipAddress,
    })
    return toAdminSkillRepositoryRow(repository as AdminSkillRepositoryRecord)
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

function normalizeAdminNote(value: string | null): string | null {
  const adminNote = value?.trim() ?? ""
  return adminNote ? adminNote : null
}

function toAdminTeamListRow(team: AdminTeamRecord) {
  const { _count, ...row } = team
  return {
    ...row,
    memberCount: _count.memberships,
  }
}

function toAdminSkillRepositoryRow(repository: AdminSkillRepositoryRecord) {
  return {
    id: repository.id,
    name: repository.name,
    title: repository.title,
    visibility: repository.visibility,
    status: repository.status,
    legacyInstallCount: repository.legacyInstallCount,
    owner: repository.owner,
    updatedAt: repository.updatedAt,
  }
}

function resolveAdminInvitationStatus(
  invitation: { readonly expiresAt: Date; readonly usedAt: Date | null },
  now: Date,
) {
  if (invitation.usedAt) return "used"
  return invitation.expiresAt.getTime() <= now.getTime() ? "expired" : "pending"
}
