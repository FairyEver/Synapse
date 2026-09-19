import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common"
import { Prisma, type UserStatus } from "@prisma/client"
import { PinoLogger } from "nestjs-pino"
import { AuditLogService } from "../common/audit-log.service"
import { parsePagination, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"

type AuditRecordInput = Parameters<AuditLogService["record"]>[0]

export const teamMemberAddLimit = 100

const teamSelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true } },
} as const

type TeamRecord = Prisma.TeamGetPayload<{ select: typeof teamSelect }>

export interface TeamRow {
  readonly id: string
  readonly name: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly memberCount: number
}

export interface TeamMemberRow {
  readonly userId: string
  readonly email: string
  readonly handle: string
  readonly status: UserStatus
  readonly joinedAt: Date
}

export interface TeamMemberCandidateRow {
  readonly id: string
  readonly email: string
  readonly handle: string
  readonly status: UserStatus
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025"
}

function duplicateTeamName(): ConflictException {
  return new ConflictException("已存在同名团队。")
}

const teamNameMaxLength = 30

/** 去首尾空白后必须是 1–30 个字符。控制器已有 zod 校验，这里兜住直接调用 service 的路径。 */
function normalizeTeamName(value: string): string {
  const name = value.trim()
  if (!name) throw new BadRequestException("团队名称不能为空。")
  if (name.length > teamNameMaxLength) throw new BadRequestException(`团队名称不能超过 ${teamNameMaxLength} 个字符。`)
  return name
}

function auditWriteErrorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

function toTeamRow(team: TeamRecord): TeamRow {
  return {
    id: team.id,
    name: team.name,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    memberCount: team._count.members,
  }
}

function toTeamOrderBy(pagination: PaginationQuery): Prisma.TeamOrderByWithRelationInput {
  if (pagination.sortBy === "memberCount") return { members: { _count: pagination.sortOrder } }
  return { [pagination.sortBy]: pagination.sortOrder }
}

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  async listTeams(pagination?: PaginationQuery): Promise<PaginatedResponse<TeamRow>> {
    const page = pagination ?? parsePagination({})
    const [data, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
        orderBy: toTeamOrderBy(page),
        select: teamSelect,
      }),
      this.prisma.team.count(),
    ])
    return {
      data: (data as TeamRecord[]).map(toTeamRow),
      total,
      page: page.page,
      pageSize: page.pageSize,
    }
  }

  /** 详情页要在冷启动（直接打开深链）时拿到团队本身，列表是分页的，不能靠它反查。 */
  async getTeam(id: string): Promise<TeamRow> {
    const team = await this.prisma.team.findUnique({ where: { id }, select: teamSelect })
    if (!team) throw new NotFoundException("团队不存在。")
    return toTeamRow(team as TeamRecord)
  }

  async createTeam(
    input: { readonly name: string },
    actorEmail = "system",
    ipAddress = "system",
  ): Promise<TeamRow> {
    const name = normalizeTeamName(input.name)
    const team = await this.prisma.team.create({
      data: { name },
      select: teamSelect,
    }).catch((error: unknown) => {
      if (isUniqueConstraintError(error)) throw duplicateTeamName()
      throw error
    })
    const row = toTeamRow(team as TeamRecord)
    await this.recordServiceManagedAuditSafely({
      adminEmail: actorEmail,
      action: "admin.team.create",
      targetType: "team",
      targetId: row.id,
      detail: { name: row.name },
      ipAddress,
    })
    return row
  }

  async renameTeam(
    id: string,
    input: { readonly name: string },
    actorEmail = "system",
    ipAddress = "system",
  ): Promise<TeamRow> {
    const name = normalizeTeamName(input.name)
    // 旧名字只服务审计里的 from，不参与重名判断（重名由数据库唯一约束兜底）。
    const existing = await this.prisma.team.findUnique({ where: { id }, select: { name: true } })
    if (!existing) throw new NotFoundException("团队不存在。")

    const team = await this.prisma.team.update({
      where: { id },
      data: { name },
      select: teamSelect,
    }).catch((error: unknown) => {
      if (isRecordNotFoundError(error)) throw new NotFoundException("团队不存在。")
      if (isUniqueConstraintError(error)) throw duplicateTeamName()
      throw error
    })
    const row = toTeamRow(team as TeamRecord)
    await this.recordServiceManagedAuditSafely({
      adminEmail: actorEmail,
      action: "admin.team.rename",
      targetType: "team",
      targetId: row.id,
      detail: { from: existing.name, to: row.name },
      ipAddress,
    })
    return row
  }

  async deleteTeam(id: string, actorEmail = "system", ipAddress = "system"): Promise<{ readonly ok: true }> {
    const existing = await this.prisma.team.findUnique({
      where: { id },
      select: teamSelect,
    })
    if (!existing) throw new NotFoundException("团队不存在。")
    // 成员关系随 Team 级联删除；用户账号不受影响。
    await this.prisma.team.delete({ where: { id } }).catch((error: unknown) => {
      if (isRecordNotFoundError(error)) throw new NotFoundException("团队不存在。")
      throw error
    })
    await this.recordServiceManagedAuditSafely({
      adminEmail: actorEmail,
      action: "admin.team.delete",
      targetType: "team",
      targetId: id,
      detail: { name: existing.name, memberCount: existing._count.members },
      ipAddress,
    })
    return { ok: true }
  }

  async listMembers(id: string, pagination?: PaginationQuery): Promise<PaginatedResponse<TeamMemberRow>> {
    const page = pagination ?? parsePagination({})
    await this.assertTeamExists(id)
    const [data, total] = await this.prisma.$transaction([
      this.prisma.teamMembership.findMany({
        where: { teamId: id },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          createdAt: true,
          user: { select: { email: true, handle: true, status: true } },
        },
      }),
      this.prisma.teamMembership.count({ where: { teamId: id } }),
    ])
    return {
      data: data.map((membership) => ({
        userId: membership.userId,
        email: membership.user.email,
        handle: membership.user.handle,
        status: membership.user.status,
        joinedAt: membership.createdAt,
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
    }
  }

  async listMemberCandidates(
    id: string,
    pagination?: PaginationQuery,
    query?: string,
  ): Promise<PaginatedResponse<TeamMemberCandidateRow>> {
    const page = pagination ?? parsePagination({})
    await this.assertTeamExists(id)
    const search = query?.trim()
    const where: Prisma.UserWhereInput = {
      teamMemberships: { none: { teamId: id } },
      ...(search ? {
        OR: [
          { email: { contains: search, mode: "insensitive" } },
          { handle: { contains: search, mode: "insensitive" } },
        ],
      } : {}),
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, handle: true, status: true },
      }),
      this.prisma.user.count({ where }),
    ])
    return { data, total, page: page.page, pageSize: page.pageSize }
  }

  async addMembers(
    id: string,
    userIds: readonly string[],
    actorEmail = "system",
    ipAddress = "system",
  ): Promise<{ readonly added: number }> {
    const uniqueUserIds = [...new Set(userIds.map((userId) => userId.trim()).filter(Boolean))]
    if (uniqueUserIds.length === 0) throw new BadRequestException("请选择要添加的用户。")
    if (uniqueUserIds.length > teamMemberAddLimit) {
      throw new BadRequestException(`一次最多添加 ${teamMemberAddLimit} 名成员。`)
    }
    await this.assertTeamExists(id)
    const existingCount = await this.prisma.user.count({ where: { id: { in: uniqueUserIds } } })
    if (existingCount !== uniqueUserIds.length) throw new BadRequestException("部分用户不存在。")

    const result = await this.prisma.teamMembership.createMany({
      data: uniqueUserIds.map((userId) => ({ teamId: id, userId })),
      skipDuplicates: true,
    })
    await this.recordServiceManagedAuditSafely({
      adminEmail: actorEmail,
      action: "admin.team.member_add",
      targetType: "team",
      targetId: id,
      detail: { count: result.count },
      ipAddress,
    })
    return { added: result.count }
  }

  async removeMember(
    id: string,
    userId: string,
    actorEmail = "system",
    ipAddress = "system",
  ): Promise<{ readonly ok: true }> {
    const result = await this.prisma.teamMembership.deleteMany({ where: { teamId: id, userId } })
    if (result.count === 0) throw new BadRequestException("该用户不在这个团队中。")
    await this.recordServiceManagedAuditSafely({
      adminEmail: actorEmail,
      action: "admin.team.member_remove",
      targetType: "team",
      targetId: id,
      detail: { userId },
      ipAddress,
    })
    return { ok: true }
  }

  private async assertTeamExists(id: string): Promise<void> {
    const team = await this.prisma.team.findUnique({ where: { id }, select: { id: true } })
    if (!team) throw new NotFoundException("团队不存在。")
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
      }, "Failed to record team audit log")
    }
  }
}
