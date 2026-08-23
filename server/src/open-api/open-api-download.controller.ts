import { Controller, Get, Inject, Param, Query, Req, Res, UseFilters } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import type { Response } from "express"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { attachmentContentDisposition } from "../common/content-disposition"
import { sendDriveZip } from "../drive/drive-download-stream"
import type { DriveStoragePort } from "../drive/drive-storage"
import { OpenApiDownloadGrantService } from "./open-api-download-grant.service"
import { OpenApiExceptionFilter } from "./open-api-exception.filter"
import { OpenApiUsageLogService, type OpenApiUsageStatus } from "./open-api-usage-log.service"
import {
  OPEN_API_DOWNLOAD_SCOPE,
  openApiRequestId,
  toOpenApiError,
  type OpenApiRequest,
} from "./open-api.types"

@Controller("/api/open/v1/downloads")
@UseFilters(OpenApiExceptionFilter)
export class OpenApiDownloadController {
  constructor(
    private readonly grants: OpenApiDownloadGrantService,
    private readonly usageLogs: OpenApiUsageLogService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
  ) {}

  @Get(":grantId")
  @SkipThrottle()
  async download(
    @Param("grantId") grantId: string,
    @Query("token") token: string | undefined,
    @Req() request: OpenApiRequest,
    @Res() response: Response,
  ): Promise<void> {
    const requestId = openApiRequestId(request)
    const grant = await this.grants.authenticate(grantId, token)
    const usage = await this.usageLogs.start({
      userId: grant.userId,
      apiKeyId: grant.apiKeyId,
      grantId: grant.id,
      requestId,
      operation: "download",
      scope: OPEN_API_DOWNLOAD_SCOPE,
      sourceType: grant.sourceType,
      artifactType: grant.artifactType,
      ipAddress: request.ip ?? "unknown",
    })
    let responseBytes = 0n
    let finished = false
    let heartbeat: NodeJS.Timeout | null = null
    const finishUsage = (
      status: Exclude<OpenApiUsageStatus, "started">,
      httpStatus: number,
      errorCode?: string,
    ) => {
      if (finished) return
      finished = true
      if (heartbeat) clearInterval(heartbeat)
      void this.usageLogs.finish({
        usageLogId: usage.id,
        requestId,
        startedAt: usage.startedAt,
        status,
        httpStatus,
        errorCode,
        grantId: grant.id,
        sourceType: grant.sourceType,
        artifactType: grant.artifactType,
        responseBytes,
      })
    }
    response.once("finish", () => finishUsage("succeeded", 200))
    response.once("close", () => {
      if (!response.writableFinished) finishUsage("aborted", 200)
    })

    try {
      await this.grants.assertAvailable(grant)
      await this.grants.renewLease(grant.id)
      heartbeat = setInterval(() => {
        void this.grants.renewLease(grant.id).catch((error: unknown) => {
          finishUsage("failed", 500, "INTERNAL_ERROR")
          response.destroy(error instanceof Error ? error : new Error("Download lease renewal failed."))
        })
      }, this.grants.leaseHeartbeatMs())
      heartbeat.unref()

      response.setHeader("X-Request-Id", requestId)
      response.setHeader("Cache-Control", "private, no-store")
      response.setHeader("Referrer-Policy", "no-referrer")
      response.setHeader("X-Content-Type-Options", "nosniff")
      response.setHeader("Content-Type", grant.mimeType)
      response.setHeader("Content-Disposition", attachmentContentDisposition(grant.fileName))

      if (grant.artifactType === "file") {
        const entry = grant.entries[0]
        if (!entry?.storageKey || entry.size === null) throw new Error("Open API file plan is invalid.")
        response.setHeader("Content-Length", entry.size.toString())
        const object = await this.storage.getObjectStream({ key: entry.storageKey })
        const counter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            responseBytes += BigInt(chunk.byteLength)
            callback(null, chunk)
          },
        })
        await pipeline(object.stream, counter, response)
        return
      }

      await sendDriveZip(response, grant.fileName, archiveEntries(grant.entries), this.storage, {
        onBytes: (bytes) => {
          responseBytes = bytes
        },
      })
    } catch (error) {
      const publicError = toOpenApiError(error)
      finishUsage("failed", publicError.statusCode, publicError.code)
      throw publicError
    }
  }
}

async function* archiveEntries(
  entries: ReadonlyArray<{ readonly relativePath: string | null; readonly storageKey: string | null }>,
) {
  for (const entry of entries) {
    if (!entry.relativePath) throw new Error("Open API archive plan is invalid.")
    yield { path: entry.relativePath, storageKey: entry.storageKey }
  }
}
