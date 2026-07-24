import { BadRequestException, Injectable, Optional } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { PinoLogger } from "nestjs-pino"
import { PrismaService } from "../prisma/prisma.service"
import { formatAuditError } from "./audit-error"
import { parsePagination, toPrismaArgs, type PaginatedResponse } from "./pagination"

const auditLogSortFields = ["createdAt", "adminEmail", "action", "targetType", "targetId"] as const
export const auditLogExportLimit = 50000
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/
const auditRecordMaxAttempts = 2

export class AuditLogWriteError extends Error {
  constructor() {
    super("审计日志写入失败。")
    this.name = "AuditLogWriteError"
  }
}

export interface AuditLogRecordInput {
  readonly adminEmail: string
  readonly action: string
  readonly targetType: string
  readonly targetId: string
  readonly detail?: unknown
  readonly ipAddress: string
}

interface AuditLogFilterOptions {
  readonly action?: string
  readonly from?: string
  readonly to?: string
}

interface AuditPersistenceErrorMetadata {
  readonly errorName: string
  readonly errorCode?: string
  readonly errorLength: number
  readonly errorMessage: string
}

function buildAuditLogWhere(options: AuditLogFilterOptions): Record<string, unknown> {
  const where: Record<string, unknown> = {}
  if (options.action) where.action = options.action
  if (options.from || options.to) {
    where.createdAt = {
      ...(options.from ? { gte: parseAuditDateBoundary(options.from, "start") } : {}),
      ...(options.to ? { lt: parseAuditDateBoundary(options.to, "end") } : {}),
    }
  }
  return where
}

function parseAuditDateBoundary(value: string, boundary: "start" | "end"): Date {
  const match = dateOnlyPattern.exec(value)
  if (!match) return parseAuditDate(value)
  const [, year, month, day] = match
  const parsedYear = Number(year)
  const parsedMonth = Number(month)
  const parsedDay = Number(day)
  const date = new Date(parsedYear, parsedMonth - 1, parsedDay)
  if (
    date.getFullYear() !== parsedYear ||
    date.getMonth() !== parsedMonth - 1 ||
    date.getDate() !== parsedDay
  ) {
    throw new BadRequestException("日期参数无效。")
  }
  if (boundary === "end") date.setDate(date.getDate() + 1)
  return date
}

function parseAuditDate(value: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new BadRequestException("日期参数无效。")
  return date
}

@Injectable()
export class AuditLogService {
  private recordFailureCount = 0

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  getRecordFailureCount(): number {
    return this.recordFailureCount
  }

  async record(input: AuditLogRecordInput): Promise<void> {
    for (let attempt = 1; attempt <= auditRecordMaxAttempts; attempt += 1) {
      try {
        await this.prisma.auditLog.create({
          data: {
            adminEmail: input.adminEmail,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId,
            detail: input.detail ?? undefined,
            ipAddress: input.ipAddress,
          },
        })
        return
      } catch (error) {
        this.recordFailureCount += 1
        this.logger?.warn({
          error: auditPersistenceErrorMetadata(error),
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          adminEmail: input.adminEmail,
          attempt,
          maxAttempts: auditRecordMaxAttempts,
          recordFailureCount: this.recordFailureCount,
        }, "Failed to record audit log")
        if (attempt === auditRecordMaxAttempts) {
          throw new AuditLogWriteError()
        }
      }
    }
  }

  async recordWithClient(
    client: Pick<Prisma.TransactionClient, "auditLog">,
    input: AuditLogRecordInput,
  ): Promise<void> {
    try {
      await client.auditLog.create({
        data: {
          adminEmail: input.adminEmail,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          detail: input.detail ?? undefined,
          ipAddress: input.ipAddress,
        },
      })
    } catch {
      throw new AuditLogWriteError()
    }
  }

  async list(options: {
    readonly action?: string
    readonly from?: string
    readonly to?: string
    readonly query?: Record<string, unknown>
  }): Promise<PaginatedResponse<unknown>> {
    const pagination = parsePagination(options.query ?? {}, { allowedSortFields: auditLogSortFields })
    const where = buildAuditLogWhere(options)

    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, ...toPrismaArgs(pagination) }),
      this.prisma.auditLog.count({ where }),
    ])

    return { data, total, page: pagination.page, pageSize: pagination.pageSize }
  }

  listForExport(options: AuditLogFilterOptions, limit = auditLogExportLimit): Promise<unknown[]> {
    return this.prisma.auditLog.findMany({
      where: buildAuditLogWhere(options),
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    })
  }
}

function auditPersistenceErrorMetadata(error: unknown): AuditPersistenceErrorMetadata {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    ...(typeof code === "string" ? { errorCode: code } : {}),
    errorLength: message.length,
    errorMessage: formatAuditError(error),
  }
}
