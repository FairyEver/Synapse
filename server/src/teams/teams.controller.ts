import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { TeamsService } from "./teams.service"

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict()

const joinTeamSchema = z.object({
  invitationToken: z.string().min(1),
}).strict()

@UseGuards(UserAuthGuard)
@Controller("/api/teams")
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  createTeam(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    return this.teams.createTeam(request.user!.id, parseBody(createTeamSchema, body, "团队创建请求无效。"))
  }

  @Get("/me")
  getMyTeam(@Req() request: AuthenticatedUserRequest) {
    return this.teams.getMyTeam(request.user!.id)
  }

  @Post("/invitations")
  createInvitation(@Req() request: AuthenticatedUserRequest) {
    return this.teams.createInvitation(request.user!.id)
  }

  @Post("/join")
  joinTeam(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    return this.teams.joinTeam(request.user!.id, parseBody(joinTeamSchema, body, "加入团队请求无效。"))
  }

  @Get("/members")
  listMembers(@Req() request: AuthenticatedUserRequest) {
    return this.teams.listMembers(request.user!.id)
  }

  @Delete("/members/:userId")
  removeMember(@Req() request: AuthenticatedUserRequest, @Param("userId") userId: string) {
    return this.teams.removeMember(request.user!.id, userId)
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw new BadRequestException(message)
  return result.data
}
