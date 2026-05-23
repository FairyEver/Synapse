import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { resolvePublicAppUrl } from "../invitations/invitation-url"
import { AuthenticatedTeamRequest, TeamsAuthGuard } from "./teams-auth.guard"
import { TeamsService } from "./teams.service"

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict()

const joinTeamSchema = z.object({
  invitationToken: z.string().min(1),
}).strict()

@UseGuards(TeamsAuthGuard)
@Controller("/api/teams")
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  createTeam(@Req() request: AuthenticatedTeamRequest, @Body() body: unknown) {
    return this.teams.createTeam(request.user!.id, parseBody(createTeamSchema, body, "团队创建请求无效。"), request.ip)
  }

  @Get("/me")
  getMyTeam(@Req() request: AuthenticatedTeamRequest) {
    return this.teams.getMyTeam(request.user!.id)
  }

  @Post("/invitations")
  createInvitation(@Req() request: AuthenticatedTeamRequest) {
    return this.teams.createInvitation(
      request.user!.id,
      resolvePublicAppUrl({
        configuredPublicAppUrl: process.env.APP_PUBLIC_URL,
        request,
      }),
      request.ip,
    )
  }

  @Post("/join")
  joinTeam(@Req() request: AuthenticatedTeamRequest, @Body() body: unknown) {
    return this.teams.joinTeam(request.user!.id, parseBody(joinTeamSchema, body, "加入团队请求无效。"), request.ip)
  }

  @Get("/members")
  listMembers(@Req() request: AuthenticatedTeamRequest) {
    return this.teams.listMembers(request.user!.id)
  }

  @Delete("/members/:userId")
  removeMember(@Req() request: AuthenticatedTeamRequest, @Param("userId") userId: string) {
    return this.teams.removeMember(request.user!.id, userId, request.ip)
  }

  @Delete("/me")
  leaveTeam(@Req() request: AuthenticatedTeamRequest) {
    return this.teams.leaveTeam(request.user!.id, request.ip)
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw new BadRequestException(message)
  return result.data
}
