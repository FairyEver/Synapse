import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { parsePagination } from "../common/pagination"
import { badRequestFromZodError } from "../common/zod-validation"
import { OrganizationService } from "./organization.service"

const name = z.string().trim().min(1).max(30)
const create = z.object({ name, parentId: z.string().min(1).nullable().optional() }).strict()
const update = z.object({ name, parentId: z.string().min(1).nullable() }).strict()
const members = z.object({ userIds: z.array(z.string().min(1)).min(1).max(100) }).strict()

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, "组织参数无效。")
  return result.data
}

@Controller("api/admin/teams/:teamId/organizations")
@UseGuards(AdminAuthGuard)
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  @Get()
  list(@Param("teamId") teamId: string, @Req() request: AdminRequest) { return this.organizations.list(teamId, request.admin?.email, request.ip) }

  @Post()
  create(@Param("teamId") teamId: string, @Body() body: unknown, @Req() request: AdminRequest) {
    return this.organizations.create(teamId, parse(create, body), request.admin?.email, request.ip)
  }

  @Patch(":id")
  update(@Param("teamId") teamId: string, @Param("id") id: string, @Body() body: unknown, @Req() request: AdminRequest) {
    return this.organizations.update(teamId, id, parse(update, body), request.admin?.email, request.ip)
  }

  @Delete(":id")
  delete(@Param("teamId") teamId: string, @Param("id") id: string, @Req() request: AdminRequest) {
    return this.organizations.delete(teamId, id, request.admin?.email, request.ip)
  }

  @Get(":id/members")
  listMembers(@Param("teamId") teamId: string, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.organizations.members(teamId, id, parsePagination(query, { allowedSortFields: ["createdAt"] }))
  }

  @Get(":id/member-candidates")
  candidates(@Param("teamId") teamId: string, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.organizations.candidates(teamId, id, typeof query.query === "string" ? query.query : undefined, parsePagination(query, { allowedSortFields: ["createdAt"] }))
  }

  @Post(":id/members")
  addMembers(@Param("teamId") teamId: string, @Param("id") id: string, @Body() body: unknown, @Req() request: AdminRequest) {
    return this.organizations.addMembers(teamId, id, parse(members, body).userIds, request.admin?.email, request.ip)
  }

  @Delete(":id/members/:userId")
  removeMember(@Param("teamId") teamId: string, @Param("id") id: string, @Param("userId") userId: string, @Req() request: AdminRequest) {
    return this.organizations.removeMember(teamId, id, userId, request.admin?.email, request.ip)
  }
}
