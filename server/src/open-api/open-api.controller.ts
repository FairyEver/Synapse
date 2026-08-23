import { Body, Controller, HttpCode, Post, Req, Res, UseFilters, UseGuards } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import type { Response } from "express"
import { z } from "zod"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { OpenApiExceptionFilter } from "./open-api-exception.filter"
import { OpenApiKeyGuard } from "./open-api-key.guard"
import { OpenApiShareLinkDownloadService } from "./open-api-share-link-download.service"
import {
  OpenApiHttpError,
  openApiRequestId,
  requireOpenApiPrincipal,
  type OpenApiRequest,
} from "./open-api.types"

const createDownloadSchema = z.object({
  url: z.string().max(2048).url(),
}).strict()

@Controller("/api/open/v1")
@UseFilters(OpenApiExceptionFilter)
export class OpenApiController {
  constructor(private readonly shareLinkDownloads: OpenApiShareLinkDownloadService) {}

  @Post("/drive/share-links/downloads")
  @HttpCode(201)
  @SkipThrottle()
  @UseGuards(OpenApiKeyGuard)
  async createDownload(
    @Body() body: unknown,
    @Req() request: OpenApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = createDownloadSchema.safeParse(body)
    if (!parsed.success) {
      throw new OpenApiHttpError(400, "INVALID_REQUEST", "请求参数无效。")
    }
    const requestId = openApiRequestId(request)
    response.setHeader("X-Request-Id", requestId)
    response.setHeader("Cache-Control", "no-store")
    const data = await this.shareLinkDownloads.create({
      principal: requireOpenApiPrincipal(request),
      requestId,
      ipAddress: request.ip ?? "unknown",
      publicAppUrl: resolvePublicAppUrl({
        configuredPublicAppUrl: process.env.APP_PUBLIC_URL,
        request,
      }),
      ...parsed.data,
    })
    return { requestId, data }
  }
}
