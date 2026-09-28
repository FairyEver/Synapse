import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { AuditLogService } from "../common/audit-log.service"
import { parsePagination, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"
import { descendantIds } from "./organization-tree"

const nameLimit = 30
const memberAddLimit = 100

function nameOf(value: string): string {
  const name = value.trim()
  if (!name || name.length > nameLimit) throw new BadRequestException("组织名称须为 1–30 个字符。")
  return name
}

function mapWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("团队内已存在同名组织。")
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw new NotFoundException("组织不存在。")
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new ConflictException("组织层级同时发生变化，请重试。")
  throw error
}

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name)

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async list(teamId: string, actor = "system", ip = "system") {
    await this.assertTeam(teamId)
    const [organizations, memberships] = await Promise.all([
      this.prisma.organization.findMany({ where: { teamId }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, parentId: true, name: true, createdAt: true, updatedAt: true } }),
      this.prisma.organizationMembership.findMany({ where: { teamId }, select: { organizationId: true, userId: true } }),
    ])
    const rows = organizations.map((organization) => {
      const subtree = new Set(descendantIds(organizations, organization.id))
      return {
        ...organization,
        teamId,
        directCount: memberships.filter((member) => member.organizationId === organization.id).length,
        memberCount: new Set(memberships.filter((member) => subtree.has(member.organizationId)).map((member) => member.userId)).size,
      }
    })
    await this.record("list", teamId, actor, ip, { teamId })
    return rows
  }

  async create(teamId: string, input: { name: string; parentId?: string | null }, actor = "system", ip = "system") {
    await this.assertTeam(teamId)
    if (input.parentId) await this.assertOrganization(teamId, input.parentId)
    const organization = await this.prisma.organization.create({ data: { teamId, name: nameOf(input.name), parentId: input.parentId ?? null } }).catch(mapWriteError)
    await this.record("create", organization.id, actor, ip, { teamId, name: organization.name, parentId: organization.parentId })
    return organization
  }

  async update(teamId: string, id: string, input: { name: string; parentId: string | null }, actor = "system", ip = "system") {
    const organization = await this.assertOrganization(teamId, id)
    if (input.parentId) await this.assertOrganization(teamId, input.parentId)
    const updated = await this.prisma.$transaction(async (tx) => {
      const tree = await tx.organization.findMany({ where: { teamId }, select: { id: true, parentId: true } })
      if (input.parentId && descendantIds(tree, id).includes(input.parentId)) throw new BadRequestException("不能将组织移动到自身或下级。")
      return tx.organization.update({ where: { id }, data: { name: nameOf(input.name), parentId: input.parentId } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(mapWriteError)
    await this.record("update", id, actor, ip, { teamId, from: { name: organization.name, parentId: organization.parentId }, to: { name: updated.name, parentId: updated.parentId } })
    return updated
  }

  async delete(teamId: string, id: string, actor = "system", ip = "system") {
    const organization = await this.assertOrganization(teamId, id)
    await this.prisma.organization.delete({ where: { id } }).catch(mapWriteError)
    await this.record("delete", id, actor, ip, { teamId, name: organization.name })
    return { ok: true as const }
  }

  async members(teamId: string, id: string, pagination?: PaginationQuery) {
    await this.assertOrganization(teamId, id)
    const page = pagination ?? parsePagination({})
    const where = { organizationId: id }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.organizationMembership.findMany({ where, orderBy: { createdAt: "asc" }, skip: (page.page - 1) * page.pageSize, take: page.pageSize, select: { userId: true, createdAt: true, user: { select: { email: true, handle: true, status: true } } } }),
      this.prisma.organizationMembership.count({ where }),
    ])
    return { data: rows.map((row) => ({ userId: row.userId, email: row.user.email, handle: row.user.handle, status: row.user.status, joinedAt: row.createdAt })), total, page: page.page, pageSize: page.pageSize }
  }

  async candidates(teamId: string, id: string, query: string | undefined, pagination?: PaginationQuery) {
    await this.assertOrganization(teamId, id)
    const page = pagination ?? parsePagination({})
    const search = query?.trim()
    const where: Prisma.TeamMembershipWhereInput = { teamId, organizations: { none: { organizationId: id } }, ...(search ? { user: { OR: [{ email: { contains: search, mode: "insensitive" } }, { handle: { contains: search, mode: "insensitive" } }] } } : {}) }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.teamMembership.findMany({ where, orderBy: { createdAt: "asc" }, skip: (page.page - 1) * page.pageSize, take: page.pageSize, select: { userId: true, user: { select: { email: true, handle: true, status: true } } } }),
      this.prisma.teamMembership.count({ where }),
    ])
    return { data: rows.map((row) => ({ id: row.userId, email: row.user.email, handle: row.user.handle, status: row.user.status })), total, page: page.page, pageSize: page.pageSize }
  }

  async addMembers(teamId: string, id: string, userIds: string[], actor = "system", ip = "system") {
    await this.assertOrganization(teamId, id)
    const unique = [...new Set(userIds)]
    if (!unique.length || unique.length > memberAddLimit) throw new BadRequestException("一次请选择 1–100 名成员。")
    const count = await this.prisma.teamMembership.count({ where: { teamId, userId: { in: unique } } })
    if (count !== unique.length) throw new BadRequestException("成员必须属于当前团队。")
    const result = await this.prisma.organizationMembership.createMany({ data: unique.map((userId) => ({ organizationId: id, teamId, userId })), skipDuplicates: true })
    await this.record("member_add", id, actor, ip, { teamId, count: result.count })
    return { added: result.count }
  }

  async removeMember(teamId: string, id: string, userId: string, actor = "system", ip = "system") {
    await this.assertOrganization(teamId, id)
    const result = await this.prisma.organizationMembership.deleteMany({ where: { organizationId: id, userId } })
    if (!result.count) throw new BadRequestException("该成员不在组织中。")
    await this.record("member_remove", id, actor, ip, { teamId, userId })
    return { ok: true as const }
  }

  private async assertTeam(id: string) {
    if (!await this.prisma.team.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException("团队不存在。")
  }

  private async assertOrganization(teamId: string, id: string) {
    const organization = await this.prisma.organization.findFirst({ where: { id, teamId }, select: { id: true, name: true, parentId: true } })
    if (!organization) throw new NotFoundException("组织不存在。")
    return organization
  }

  private async record(action: string, id: string, adminEmail: string, ipAddress: string, detail: unknown) {
    try { await this.audit.record({ adminEmail, action: `admin.organization.${action}`, targetType: "organization", targetId: id, detail, ipAddress }) }
    catch (error) { this.logger.warn({ action, organizationId: id, reason: error instanceof Error ? error.name : typeof error }, "Organization audit failed") }
  }
}
