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
    throw new BadRequestException("Query param 'limit' must be a number");
  }
  return Math.min(Math.max(limit, 1), MAX_RECENT_LOG_LIMIT);
}

@Controller("/api/admin/logs")
@UseGuards(AdminAuthGuard)
export class LogFileController {
  constructor(
    private readonly logFileService: LogFileService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get("files")
  async listFiles() {
    return this.logFileService.listFiles();
  }

  @Get("recent")
  async getRecent(
    @Query("level") level?: string,
    @Query("limit") limitStr?: string,
  ) {
    const limit = parseRecentLogLimit(limitStr);
    if (level && !["debug", "info", "warn", "error", "fatal"].includes(level)) {
      throw new BadRequestException(`Invalid level: ${level}`);
    }
    return this.logFileService.readRecent({ level, limit });
  }

  @Get("download")
  async download(
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Res() res: Response,
    @Req() request?: AdminRequest,
  ) {
    const buffer = await this.logFileService.downloadAsZip({ from, to });
    const filename = from || to
      ? `logs-${from ?? "start"}-${to ?? "now"}.zip`
      : "logs-all.zip";

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": buffer.length.toString(),
    });
    await this.auditLog.record({
      adminEmail: request?.admin?.email ?? "",
      action: "logs.download",
      targetType: "logs",
      targetId: filename,
      detail: { from, to, filename, bytes: buffer.length },
      ipAddress: request?.ip ?? "",
    });
    res.send(buffer);
  }

  @Delete("cleanup")
  async cleanup(@Query("before") before: string | undefined, @Req() request?: AdminRequest) {
    if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
      throw new BadRequestException("Query param 'before' must be YYYY-MM-DD format");
    }
    const deleted = await this.logFileService.cleanup(before);
    await this.auditLog.record({
      adminEmail: request?.admin?.email ?? "",
      action: "logs.cleanup",
      targetType: "logs",
      targetId: before,
      detail: { before, deleted },
      ipAddress: request?.ip ?? "",
    });
    return { deleted };
  }
}
