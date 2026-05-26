import { Controller, Get, Delete, Query, Req, Res, UseGuards, BadRequestException } from "@nestjs/common";
import type { Response } from "express";
import { LogFileService } from "./log-file.service";
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard";
import { AuditLogService } from "../common/audit-log.service";

const DEFAULT_RECENT_LOG_LIMIT = 200;
const MAX_RECENT_LOG_LIMIT = 1000;

function parseRecentLogLimit(limitStr?: string): number {
  if (!limitStr) return DEFAULT_RECENT_LOG_LIMIT;
  const limit = Number.parseInt(limitStr, 10);
  if (!Number.isFinite(limit)) {
    throw new BadRequestException("limit 参数必须为数字。");
  }
  return Math.min(Math.max(limit, 1), MAX_RECENT_LOG_LIMIT);
}

function parseLogDateQuery(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${name} 参数必须为 YYYY-MM-DD 格式。`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${name} 参数必须为有效日期。`);
  }
  return value;
}

function parseCleanupBeforeDate(before: string | undefined): string {
  const parsed = parseLogDateQuery(before, "before");
  if (!parsed) {
    throw new BadRequestException("before 参数必须为 YYYY-MM-DD 格式。");
  }
  if (parsed > new Date().toISOString().slice(0, 10)) {
    throw new BadRequestException("before 不能是未来日期。");
  }
  return parsed;
}

function parseDownloadDateRange(from: string | undefined, to: string | undefined): { from?: string; to?: string } {
  const parsedFrom = parseLogDateQuery(from, "from");
  const parsedTo = parseLogDateQuery(to, "to");
  if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
    throw new BadRequestException("from 不能晚于 to。");
  }
  return { from: parsedFrom, to: parsedTo };
}

@Controller("/api/admin/logs")
@UseGuards(AdminAuthGuard)
export class LogFileController {
  constructor(
    private readonly logFileService: LogFileService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get("files")
  async listFiles(@Req() request?: AdminRequest) {
    const files = await this.logFileService.listFiles();
    await this.recordLogAudit(request, {
      action: "logs.list_files",
      targetId: "files",
      detail: { count: files.length },
    });
    return files;
  }

  @Get("recent")
  async getRecent(
    @Query("from") from: string | undefined,
    @Query("level") level?: string,
    @Query("limit") limitStr?: string,
    @Query("to") to?: string,
    @Req() request?: AdminRequest,
  ) {
    const limit = parseRecentLogLimit(limitStr);
    const range = parseDownloadDateRange(from, to);
    if (level && !["debug", "info", "warn", "error", "fatal"].includes(level)) {
      throw new BadRequestException(`无效的日志级别：${level}`);
    }
    const entries = await this.logFileService.readRecent({ ...range, level, limit });
    await this.recordLogAudit(request, {
      action: "logs.recent",
      targetId: "recent",
      detail: { from: range.from, level, limit, to: range.to, count: entries.length },
    });
    return entries;
  }

  @Get("download")
  async download(
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Res() res: Response,
    @Req() request?: AdminRequest,
  ) {
    const range = parseDownloadDateRange(from, to);
    const filename = range.from || range.to
      ? `logs-${range.from ?? "start"}-${range.to ?? "now"}.zip`
      : "logs-all.zip";

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });
    let result: Awaited<ReturnType<LogFileService["streamZipTo"]>>;
    try {
      result = await this.logFileService.streamZipTo(res, range);
    } catch (error) {
      if (!res.headersSent) throw error;
      await this.recordLogAudit(request, {
        action: "logs.download.failed",
        targetId: filename,
        detail: {
          from: range.from,
          to: range.to,
          filename,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    await this.recordLogAudit(request, {
      action: "logs.download",
      targetId: filename,
      detail: { from: range.from, to: range.to, filename, bytes: result.bytes, fileCount: result.fileCount },
    });
  }

  @Delete("cleanup")
  async cleanup(@Query("before") before: string | undefined, @Req() request?: AdminRequest) {
    const cutoffDate = parseCleanupBeforeDate(before);
    const deleted = await this.logFileService.cleanup(cutoffDate);
    await this.recordLogAudit(request, {
      action: "logs.cleanup",
      targetId: cutoffDate,
      detail: { before: cutoffDate, deleted },
    });
    return { deleted };
  }

  private recordLogAudit(
    request: AdminRequest | undefined,
    input: { action: string; targetId: string; detail: unknown },
  ) {
    return this.auditLog.record({
      adminEmail: request?.admin?.email ?? "",
      action: input.action,
      targetType: "logs",
      targetId: input.targetId,
      detail: input.detail,
      ipAddress: request?.ip ?? "",
    });
  }
}
