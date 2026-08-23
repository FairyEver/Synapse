import { Injectable } from "@nestjs/common"
import { DriveLinkIntakeService } from "../drive/drive-link-intake.service"
import { DriveOpenApiDownloadPreparationError } from "../drive/drive-open-api-download"
import type { OpenApiPrincipal } from "../api-keys/api-key.service"
import { OpenApiDownloadGrantService } from "./open-api-download-grant.service"
import { OpenApiUsageLogService } from "./open-api-usage-log.service"
import {
  OPEN_API_DOWNLOAD_SCOPE,
  OpenApiHttpError,
  requireOpenApiScope,
  toOpenApiError,
} from "./open-api.types"

@Injectable()
export class OpenApiShareLinkDownloadService {
  constructor(
    private readonly driveLinks: DriveLinkIntakeService,
    private readonly grants: OpenApiDownloadGrantService,
    private readonly usageLogs: OpenApiUsageLogService,
  ) {}

  async create(input: {
    readonly principal: OpenApiPrincipal
    readonly requestId: string
    readonly ipAddress: string
    readonly publicAppUrl: string
    readonly url: string
  }) {
    requireOpenApiScope(input.principal, OPEN_API_DOWNLOAD_SCOPE)
    const usage = await this.usageLogs.start({
      userId: input.principal.userId,
      apiKeyId: input.principal.apiKeyId,
      requestId: input.requestId,
      operation: "grant_create",
      scope: OPEN_API_DOWNLOAD_SCOPE,
      ipAddress: input.ipAddress,
    })
    try {
      const artifact = await this.driveLinks.prepareDownloadArtifact({
        url: input.url,
      })
      const grant = await this.grants.create({
        userId: input.principal.userId,
        apiKeyId: input.principal.apiKeyId,
        artifact,
      })
      await this.usageLogs.finish({
        usageLogId: usage.id,
        requestId: input.requestId,
        startedAt: usage.startedAt,
        status: "succeeded",
        httpStatus: 201,
        grantId: grant.grantId,
        sourceType: artifact.sourceType,
        artifactType: artifact.artifactType,
      })
      return {
        sourceType: artifact.sourceType,
        artifact: {
          type: artifact.artifactType,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          size: artifact.size?.toString() ?? null,
          entryPath: artifact.entryPath,
          snapshotId: grant.snapshotId,
        },
        download: {
          method: "GET" as const,
          url: `${input.publicAppUrl.replace(/\/+$/u, "")}/api/open/v1/downloads/${encodeURIComponent(grant.grantId)}?token=${encodeURIComponent(grant.token)}`,
          expiresAt: grant.expiresAt.toISOString(),
        },
      }
    } catch (error) {
      const publicError = mapPreparationError(error)
      await this.usageLogs.finish({
        usageLogId: usage.id,
        requestId: input.requestId,
        startedAt: usage.startedAt,
        status: "failed",
        httpStatus: publicError.statusCode,
        errorCode: publicError.code,
      })
      throw publicError
    }
  }
}

function mapPreparationError(error: unknown): OpenApiHttpError {
  if (!(error instanceof DriveOpenApiDownloadPreparationError)) return toOpenApiError(error)
  if (error.reason === "unsupported_link") {
    return new OpenApiHttpError(422, "UNSUPPORTED_LINK", "不支持该公共链接。")
  }
  if (error.reason === "password_required") {
    return new OpenApiHttpError(403, "LINK_PASSWORD_REQUIRED_OR_INVALID", "链接密码缺失或错误。")
  }
  if (error.reason === "archive_too_large") {
    return new OpenApiHttpError(413, "ARCHIVE_TOO_LARGE", "归档内容超过支持范围。")
  }
  return new OpenApiHttpError(404, "LINK_NOT_FOUND", "公共链接不存在或已失效。")
}
