import { Body, Controller, HttpCode, Post, Req, Res, UseFilters, UseGuards } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import type { Response } from "express"
import { resolvePublicAppUrl } from "../common/public-app-url"
import {
  OPEN_API_CREATE_DOWNLOAD_PATHS,
  OPEN_API_V1_BASE_PATH,
  createDownloadRequestSchema,
} from "./open-api-contract"
import { OpenApiExceptionFilter } from "./open-api-exception.filter"
import { OpenApiKeyGuard } from "./open-api-key.guard"
import { OpenApiShareLinkDownloadService } from "./open-api-share-link-download.service"
import {
  OpenApiHttpError,
  openApiRequestId,
  requireOpenApiPrincipal,
  type OpenApiRequest,
} from "./open-api.types"

@Controller(OPEN_API_V1_BASE_PATH)
@UseFilters(OpenApiExceptionFilter)
export class OpenApiController {
  constructor(private readonly shareLinkDownloads: OpenApiShareLinkDownloadService) {}

  @Post([...OPEN_API_CREATE_DOWNLOAD_PATHS])
  @HttpCode(201)
  @SkipThrottle()
  @UseGuards(OpenApiKeyGuard)
  async createDownload(
    @Body() body: unknown,
    @Req() request: OpenApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = createDownloadRequestSchema.safeParse(body)
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
