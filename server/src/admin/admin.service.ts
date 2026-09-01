import { Injectable, NotFoundException, Optional } from "@nestjs/common"
import { Prisma, type UserStatus } from "@prisma/client"
import { PinoLogger } from "nestjs-pino"
import { AuditLogService } from "../common/audit-log.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { PrismaService } from "../prisma/prisma.service"

type AuditRecordInput = Parameters<AuditLogService["record"]>[0]
type SkillRepositoryAdminListFilters = {
  readonly status?: "active" | "removed"
  readonly query?: string
}
const adminUserSelect = {
  id: true,
  email: true,
  handle: true,
  adminNote: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const

const adminSkillRepositorySelect = {
  id: true,
  name: true,
  title: true,
  visibility: true,
  status: true,
  owner: { select: { id: true, handle: true } },
  updatedAt: true,
} as const

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
      activeUsers,
      disabledUsers,
      ...dailyTrendCounts
    ] = await this.prisma.$transaction([
      this.prisma.auditLog.count(),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: "active" } }),
      this.prisma.user.count({ where: { status: "disabled" } }),
      ...trendBuckets.flatMap((bucket) => [
        this.prisma.user.count({ where: { createdAt: { gte: bucket.start, lt: bucket.end } } }),
        this.prisma.auditLog.count({ where: { createdAt: { gte: bucket.start, lt: bucket.end } } }),
      ]),
    ])

    return {
      serverTime: now.toISOString(),
      counts: {
        auditLogs,
        users,
      },
      userStatus: {
        active: activeUsers,
        disabled: disabledUsers,
      },
      dailyTrend: trendBuckets.map((bucket, index) => ({
        date: bucket.date,
        label: bucket.label,
        users: dailyTrendCounts[index * 2] ?? 0,
        auditLogs: dailyTrendCounts[index * 2 + 1] ?? 0,
      })),
    }
  }

  async listUsers(pagination?: PaginationQuery, search?: string): Promise<PaginatedResponse<unknown>> {
    const page = pagination ?? parsePagination({})
    const where = search
      ? {
          OR: [
            { id: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { handle: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : undefined
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        ...toPrismaArgs(page),
        where,
        select: adminUserSelect,
      }),
      this.prisma.user.count({ where }),
    ])
    return { data, total, page: page.page, pageSize: page.pageSize }
  }

  async updateUserStatus(id: string, input: { status: UserStatus }, actorEmail = "system", ipAddress = "system") {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!existing) throw new NotFoundException("用户不存在。")

    const user = await this.prisma.user.update({
      where: { id },
      data: { status: input.status },
      select: adminUserSelect,
    }).catch((error: unknown) => {
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

function toAdminSkillRepositoryRow(repository: AdminSkillRepositoryRecord) {
  return {
    id: repository.id,
    name: repository.name,
    title: repository.title,
    visibility: repository.visibility,
    status: repository.status,
    owner: repository.owner,
    updatedAt: repository.updatedAt,
  }
}
