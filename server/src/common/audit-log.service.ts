import { Injectable, Optional } from "@nestjs/common"
import { PinoLogger } from "nestjs-pino"
import { PrismaService } from "../prisma/prisma.service"
import { parsePagination, toPrismaArgs, type PaginatedResponse } from "./pagination"

const auditLogSortFields = ["createdAt", "adminEmail", "action", "targetType", "targetId"] as const

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
      ...(options.from ? { gte: new Date(options.from) } : {}),
      ...(options.to ? { lte: new Date(options.to) } : {}),
    }
  }
  return where
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

  listForExport(options: AuditLogFilterOptions): Promise<unknown[]> {
    return this.prisma.auditLog.findMany({
      where: buildAuditLogWhere(options),
      orderBy: { createdAt: "desc" },
    })
  }
}
