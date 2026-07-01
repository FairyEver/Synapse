import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common"
import {
  agentPersonaCreateInputSchema,
  agentPersonaPreferenceUpdateInputSchema,
  agentPersonaUpdateInputSchema,
} from "@synapse/shared"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { AgentPersonasService } from "./agent-personas.service"

@UseGuards(UserAuthGuard)
@Controller("/api/agent-personas")
export class AgentPersonasController {
  constructor(private readonly service: AgentPersonasService) {}

  @Get()
  list(@Req() request: AuthenticatedUserRequest) {
    return this.service.list(requireUserId(request))
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(agentPersonaCreateInputSchema, body, "智能体请求无效。")
    return this.service.create(requireUserId(request), parsed)
  }

  @Put("/:id")
  update(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(agentPersonaUpdateInputSchema, body, "智能体请求无效。")
    return this.service.update(requireUserId(request), id, parsed)
  }

  @Delete("/:id")
  async delete(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    await this.service.delete(requireUserId(request), id)
    return { ok: true }
  }

  @Put("/builtin/:id/preferences")
  updateBuiltinPreference(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(agentPersonaPreferenceUpdateInputSchema, body, "智能体设置请求无效。")
    return this.service.updateBuiltinPreference(requireUserId(request), id, parsed)
  }
}

function requireUserId(request: AuthenticatedUserRequest): string {
  if (!request.user?.id) throw new BadRequestException("账号信息无效。")
  return request.user.id
}

function parseBody<T>(
  schema: { parse: (value: unknown) => T },
  body: unknown,
  message: string,
): T {
  try {
    return schema.parse(body)
  } catch {
    throw new BadRequestException(message)
  }
}
