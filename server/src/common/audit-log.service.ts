import { BadRequestException, Injectable, Optional } from "@nestjs/common"
import { PinoLogger } from "nestjs-pino"
import { PrismaService } from "../prisma/prisma.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse } from "./pagination"

const auditLogSortFields = ["createdAt", "adminEmail", "action", "targetType", "targetId"] as const
export const auditLogExportLimit = 50000
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/

interface AuditLogFilterOptions {
  readonly action?: string
  readonly from?: string
  readonly to?: string
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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  async record(input: {
    adminEmail: string
    action: string
    targetType: string
    targetId: string
    detail?: unknown
    ipAddress: string
  }): Promise<void> {
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
    } catch (error) {
      this.logger?.warn({
        err: error,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        adminEmail: input.adminEmail,
      }, "Failed to record audit log")
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
