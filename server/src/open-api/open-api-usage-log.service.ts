import { Injectable } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { PinoLogger } from "nestjs-pino"
import { toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"
import { OpenApiHttpError } from "./open-api.types"

export type OpenApiUsageOperation = "grant_create" | "download"
export type OpenApiUsageStatus = "started" | "succeeded" | "failed" | "aborted"

type StartedUsageLog = {
  readonly id: string
  readonly startedAt: Date
}

export type OpenApiUsageLogDto = {
  readonly id: string
  readonly requestId: string
  readonly operation: OpenApiUsageOperation
  readonly status: OpenApiUsageStatus
  readonly httpStatus: number | null
  readonly errorCode: string | null
  readonly sourceType: string | null
  readonly artifactType: string | null
  readonly durationMs: number | null
  readonly responseBytes: string | null
  readonly startedAt: string
  readonly completedAt: string | null
}

@Injectable()
export class OpenApiUsageLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async start(input: {
    readonly userId: string
    readonly apiKeyId: string
    readonly grantId?: string | null
    readonly requestId: string
    readonly operation: OpenApiUsageOperation
    readonly scope: string
    readonly sourceType?: string | null
    readonly artifactType?: string | null
    readonly ipAddress: string
  }): Promise<StartedUsageLog> {
    try {
      return await this.prisma.openApiUsageLog.create({
        data: {
          userId: input.userId,
          apiKeyId: input.apiKeyId,
          grantId: input.grantId ?? null,
          requestId: input.requestId,
          operation: input.operation,
          scope: input.scope,
          status: "started",
          sourceType: input.sourceType ?? null,
          artifactType: input.artifactType ?? null,
          ipAddress: input.ipAddress,
        },
        select: { id: true, startedAt: true },
      })
    } catch (error) {
      this.logger.error({
        requestId: input.requestId,
        operation: input.operation,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Open API usage log start failed")
      throw new OpenApiHttpError(503, "USAGE_LOG_UNAVAILABLE", "用量记录暂时不可用。")
    }
  }

  async finish(input: {
    readonly usageLogId: string
    readonly requestId: string
    readonly startedAt: Date
    readonly status: Exclude<OpenApiUsageStatus, "started">
    readonly httpStatus: number
    readonly errorCode?: string | null
    readonly grantId?: string | null
    readonly sourceType?: string | null
    readonly artifactType?: string | null
    readonly responseBytes?: bigint | null
  }): Promise<void> {
    const completedAt = new Date()
    try {
      await this.prisma.openApiUsageLog.update({
        where: { id: input.usageLogId },
        data: {
          status: input.status,
          httpStatus: input.httpStatus,
          errorCode: input.errorCode ?? null,
          grantId: input.grantId,
          sourceType: input.sourceType,
          artifactType: input.artifactType,
          responseBytes: input.responseBytes,
          durationMs: Math.max(0, completedAt.getTime() - input.startedAt.getTime()),
          completedAt,
        },
      })
    } catch (error) {
      this.logger.warn({
        requestId: input.requestId,
        usageLogId: input.usageLogId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Open API usage log finish failed")
    }
  }

  async listForUser(
    userId: string,
    apiKeyId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedResponse<OpenApiUsageLogDto>> {
    const owned = await this.prisma.userApiKey.findFirst({
      where: { id: apiKeyId, userId },
      select: { id: true },
    })
    if (!owned) return { data: [], total: 0, page: pagination.page, pageSize: pagination.pageSize }
    const where = { userId, apiKeyId }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.openApiUsageLog.findMany({ where, ...toPrismaArgs(pagination) }),
      this.prisma.openApiUsageLog.count({ where }),
    ])
    return {
      data: rows.map((row) => ({
        id: row.id,
        requestId: row.requestId,
        operation: row.operation as OpenApiUsageOperation,
        status: row.status as OpenApiUsageStatus,
        httpStatus: row.httpStatus,
        errorCode: row.errorCode,
        sourceType: row.sourceType,
        artifactType: row.artifactType,
        durationMs: row.durationMs,
        responseBytes: row.responseBytes?.toString() ?? null,
        startedAt: row.startedAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      })),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  }

  @Cron("20 3 * * *")
  async cleanupExpired(now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    try {
      await this.prisma.openApiUsageLog.deleteMany({ where: { startedAt: { lt: cutoff } } })
    } catch (error) {
      this.logger.warn({
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Open API usage log cleanup failed")
    }
  }
}
