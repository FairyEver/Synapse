import { Body, Controller, Headers, HttpCode, Post, Req, Res, UseFilters, UseGuards } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import type { Response } from "express"
import { PUBLIC_LINK_MESSAGE_CREATE_SCOPE } from "../api-keys/api-key-capabilities"
import { OPEN_API_ARTICLE_MESSAGE_PATH, OPEN_API_V1_BASE_PATH, createArticleMessageRequestSchema } from "./open-api-contract"
import { OpenApiMessageService } from "./open-api-message.service"
import { OpenApiExceptionFilter } from "./open-api-exception.filter"
import { OpenApiKeyGuard } from "./open-api-key.guard"
import { OpenApiHttpError, openApiRequestId, requireOpenApiPrincipal, requireOpenApiScope, type OpenApiRequest } from "./open-api.types"

const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,120}$/u

@Controller(OPEN_API_V1_BASE_PATH)
@UseFilters(OpenApiExceptionFilter)
export class OpenApiMessageController {
  constructor(private readonly messages: OpenApiMessageService) {}

  @Post(OPEN_API_ARTICLE_MESSAGE_PATH)
  @HttpCode(201)
  @SkipThrottle()
  @UseGuards(OpenApiKeyGuard)
  async create(
    @Body() body: unknown,
    @Req() request: OpenApiRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const principal = requireOpenApiPrincipal(request)
    requireOpenApiScope(principal, PUBLIC_LINK_MESSAGE_CREATE_SCOPE)
    if (idempotencyKey !== undefined && !idempotencyKeyPattern.test(idempotencyKey)) {
      throw new OpenApiHttpError(400, "INVALID_IDEMPOTENCY_KEY", "去重键无效。")
    }
    const parsed = createArticleMessageRequestSchema.safeParse(body)
    if (!parsed.success) {
      const missingTarget = body && typeof body === "object" && !Array.isArray(body)
        && !("url" in body) && !("shareId" in body)
      throw missingTarget
        ? new OpenApiHttpError(400, "TARGET_REQUIRED", "必须提供 url 或 shareId。")
        : new OpenApiHttpError(400, "INVALID_REQUEST", "留言请求参数无效。")
    }
    const requestId = openApiRequestId(request)
    response.setHeader("X-Request-Id", requestId)
    response.setHeader("Cache-Control", "no-store")
    const data = await this.messages.create({
      principal, requestId, ipAddress: request.ip ?? "unknown", idempotencyKey, body: parsed.data,
    })
    return { requestId, data }
  }
}
