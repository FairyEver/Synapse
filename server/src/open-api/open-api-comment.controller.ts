import { Body, Controller, Headers, HttpCode, Post, Req, Res, UseFilters, UseGuards } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import type { Response } from "express"
import { PUBLIC_LINK_COMMENT_CREATE_SCOPE } from "../api-keys/api-key-capabilities"
import { OPEN_API_ARTICLE_COMMENT_PATH, OPEN_API_V1_BASE_PATH, createArticleCommentRequestSchema } from "./open-api-contract"
import { OpenApiCommentService } from "./open-api-comment.service"
import { OpenApiExceptionFilter } from "./open-api-exception.filter"
import { OpenApiKeyGuard } from "./open-api-key.guard"
import { OpenApiHttpError, openApiRequestId, requireOpenApiPrincipal, requireOpenApiScope, type OpenApiRequest } from "./open-api.types"

const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,120}$/u

@Controller(OPEN_API_V1_BASE_PATH)
@UseFilters(OpenApiExceptionFilter)
export class OpenApiCommentController {
  constructor(private readonly comments: OpenApiCommentService) {}

  @Post(OPEN_API_ARTICLE_COMMENT_PATH)
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
    requireOpenApiScope(principal, PUBLIC_LINK_COMMENT_CREATE_SCOPE)
    if (idempotencyKey !== undefined && !idempotencyKeyPattern.test(idempotencyKey)) {
      throw new OpenApiHttpError(400, "INVALID_IDEMPOTENCY_KEY", "去重键无效。")
    }
    const parsed = createArticleCommentRequestSchema.safeParse(body)
    if (!parsed.success) {
      const missingTarget = body && typeof body === "object" && !Array.isArray(body)
        && !("url" in body) && !("shareId" in body)
      throw missingTarget
        ? new OpenApiHttpError(400, "TARGET_REQUIRED", "必须提供 url 或 shareId。")
        : new OpenApiHttpError(400, "INVALID_REQUEST", "评论请求参数无效。")
    }
    const requestId = openApiRequestId(request)
    response.setHeader("X-Request-Id", requestId)
    response.setHeader("Cache-Control", "no-store")
    const data = await this.comments.create({
      principal, requestId, ipAddress: request.ip ?? "unknown", idempotencyKey, body: parsed.data,
    })
    return { requestId, data }
  }
}
