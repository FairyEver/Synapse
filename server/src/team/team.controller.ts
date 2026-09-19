import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuditLogService } from "../common/audit-log.service"
import { parsePagination } from "../common/pagination"
import { badRequestFromZodError } from "../common/zod-validation"
import { TeamService, teamMemberAddLimit } from "./team.service"

const teamNameSchema = z.object({
  name: z.string().trim().min(1, "不能为空").max(30, "不能超过 30 个字符"),
}).strict()

const teamMemberAddSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1, "至少选择 1 项").max(
    teamMemberAddLimit,
    `一次最多添加 ${teamMemberAddLimit} 名成员`,
  ),
}).strict()

const teamSortFields = ["createdAt", "updatedAt", "name", "memberCount"] as const
const teamMemberSortFields = ["createdAt", "updatedAt"] as const

type AuditRecordInput = Parameters<AuditLogService["record"]>[0]

@UseGuards(AdminAuthGuard)
@Controller("/api/admin/teams")
export class TeamController {
  private readonly logger = new Logger(TeamController.name)

  constructor(
    private readonly teams: TeamService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  async listTeams(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: teamSortFields })
    const result = await this.teams.listTeams(pagination)
    await this.recordAdminRead(request, {
      action: "admin.teams.list",
      targetType: "team",
      targetId: "list",
      detail: { page: pagination.page, pageSize: pagination.pageSize },
    })
    return result
  }

  @Get("/:id")
  getTeam(@Param("id") id: string) {
    return this.teams.getTeam(id)
  }

  @Post()
  async createTeam(@Body() body: unknown, @Req() request?: AdminRequest) {
    const input = parseBody(teamNameSchema, body, "团队名称无效。")
    return this.teams.createTeam(input, request?.admin?.email, request?.ip)
  }

  @Patch("/:id")
  async renameTeam(@Param("id") id: string, @Body() body: unknown, @Req() request?: AdminRequest) {
    const input = parseBody(teamNameSchema, body, "团队名称无效。")
    return this.teams.renameTeam(id, input, request?.admin?.email, request?.ip)
  }

  @Delete("/:id")
  deleteTeam(@Param("id") id: string, @Req() request?: AdminRequest) {
    return this.teams.deleteTeam(id, request?.admin?.email, request?.ip)
  }

  @Get("/:id/members")
  listMembers(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    const pagination = parsePagination(query, { allowedSortFields: teamMemberSortFields })
    return this.teams.listMembers(id, pagination)
  }

  @Get("/:id/member-candidates")
  listMemberCandidates(@Param("id") id: string, @Query() query: Record<string, unknown>) {
    const pagination = parsePagination(query, { allowedSortFields: teamMemberSortFields })
    const search = typeof query.query === "string" ? query.query.trim() : undefined
    return this.teams.listMemberCandidates(id, pagination, search || undefined)
  }

  @Post("/:id/members")
  async addMembers(@Param("id") id: string, @Body() body: unknown, @Req() request?: AdminRequest) {
    const input = parseBody(teamMemberAddSchema, body, "成员参数无效。")
    return this.teams.addMembers(id, input.userIds, request?.admin?.email, request?.ip)
  }

  @Delete("/:id/members/:userId")
  removeMember(@Param("id") id: string, @Param("userId") userId: string, @Req() request?: AdminRequest) {
    return this.teams.removeMember(id, userId, request?.admin?.email, request?.ip)
  }

  private async recordAdminRead(
    request: AdminRequest | undefined,
    input: {
      readonly action: string
      readonly targetType: string
      readonly targetId: string
      readonly detail?: unknown
    },
  ): Promise<void> {
    const auditInput: AuditRecordInput = {
      adminEmail: request?.admin?.email ?? "system",
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.detail === undefined ? undefined : { detail: input.detail }),
      ipAddress: request?.ip ?? "system",
    }
    try {
      await this.auditLog.record(auditInput)
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        ...auditWriteErrorMetadata(error),
      }, "Failed to record team audit log")
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

function parseBody<T extends z.ZodType>(schema: T, body: unknown, fallback: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, fallback)
  return result.data
}
