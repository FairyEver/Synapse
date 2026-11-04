import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards } from "@nestjs/common"
import {
  skillHubAdminListInputSchema, skillHubAssignMaintainerInputSchema, skillHubIdSchema, skillHubRevisionInputSchema,
} from "@synapse/shared/skill-hub-contracts"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { SkillHubAdminService } from "./skill-hub-admin.service"
import { hubPageQuery, parseHubInput } from "./skill-hub-http"

const actor = (request: AdminRequest) => ({ sessionId: request.admin!.sessionId, ip: request.ip ?? "" })

@UseGuards(AdminAuthGuard)
@Controller("/api/admin/skill-hub/skills")
export class SkillHubAdminController {
  constructor(private readonly admin: SkillHubAdminService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Req() request: AdminRequest, @Query() query: Record<string, unknown>) {
    return this.admin.list(actor(request), parseHubInput(skillHubAdminListInputSchema, hubPageQuery(query, "deleted")))
  }

  @Post(":id/maintainer")
  @Header("Cache-Control", "private, no-store")
  assignMaintainer(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.admin.assignMaintainer(actor(request), parseHubInput(skillHubIdSchema, id), parseHubInput(skillHubAssignMaintainerInputSchema, body))
  }

  @Post(":id/restore")
  @Header("Cache-Control", "private, no-store")
  restore(@Req() request: AdminRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.admin.restore(actor(request), parseHubInput(skillHubIdSchema, id), parseHubInput(skillHubRevisionInputSchema, body))
  }
}
