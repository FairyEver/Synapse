import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { API_KEY_CAPABILITIES, API_KEY_SCOPES } from "./api-key-capabilities"
import { ApiKeyService } from "./api-key.service"

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).superRefine((scopes, context) => {
    if (new Set(scopes).size !== scopes.length) {
      context.addIssue({ code: "custom", message: "scopes 不能重复" })
    }
  }),
}).strict()

const updateApiKeyScopesSchema = z.object({
  scopes: z.array(z.enum(API_KEY_SCOPES)).superRefine((scopes, context) => {
    if (new Set(scopes).size !== scopes.length) {
      context.addIssue({ code: "custom", message: "scopes 不能重复" })
    }
  }),
}).strict()

const renameApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict()

const updateApiKeySchema = z.union([updateApiKeyScopesSchema, renameApiKeySchema])

@UseGuards(UserAuthGuard)
@Controller(["/api/console", "/api/dashboard"])
export class ApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Get("/api-keys")
  list(@Req() request: AuthenticatedUserRequest) {
    return this.apiKeys.listForUser(request.user!.id)
  }

  @Get("/api-key-capabilities")
  capabilities() {
    return API_KEY_CAPABILITIES
  }

  @Post("/api-keys")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  create(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const result = createApiKeySchema.safeParse(body)
    if (!result.success) {
      throw badRequestFromZodError(result.error, "API key create request is invalid.")
    }
    return this.apiKeys.createForUser(request.user!.id, result.data, request.ip)
  }

  @Patch("/api-keys/:id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const result = updateApiKeySchema.safeParse(body)
    if (!result.success) {
      throw badRequestFromZodError(result.error, "API key update request is invalid.")
    }
    if ("name" in result.data) {
      return this.apiKeys.renameForUser(request.user!.id, id, result.data, request.ip)
    }
    return this.apiKeys.updateScopesForUser(request.user!.id, id, result.data, request.ip)
  }

  @Delete("/api-keys/:id")
  revoke(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.apiKeys.revokeForUser(request.user!.id, id, request.ip)
  }
}
