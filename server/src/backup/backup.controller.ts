import { Controller, Delete, Get, Head, InternalServerErrorException, Optional, Param, Post, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { pipeline } from "node:stream/promises"
import type { AdminRequest } from "../admin-auth/admin-auth.guard"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { formatAuditError } from "../common/audit-error"
import { AuditLogService } from "../common/audit-log.service"
import { attachmentContentDisposition } from "../common/content-disposition"
import { BackupService } from "./backup.service"

@Controller("/api/admin/backup")
@UseGuards(AdminAuthGuard)
export class BackupController {
  constructor(
    private readonly backupService: BackupService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  @Post()
  async triggerBackup() {
    const result = await this.backupService.performBackup()
    if (result.status === "failed") {
      throw Object.assign(
        new InternalServerErrorException("备份失败，请检查服务器日志或备份配置。"),
        { filename: result.filename },
      )
    }
    return result
  }

  @Get("list")
  async listBackups() {
    return this.backupService.listBackups()
  }

  @Get("download/:filename")
  async downloadBackup(
    @Param("filename") filename: string,
    @Res() response: Response,
    @Req() request?: AdminRequest,
  ) {
    try {
      const stream = this.backupService.downloadBackup(filename)
      response.set({
        "Content-Type": contentType(filename),
        "Content-Disposition": attachmentContentDisposition(filename),
      })
      await pipeline(stream, response)
      await this.recordDownloadAudit(filename, request)
    } catch (error: unknown) {
      await this.recordDownloadAudit(filename, request, error)
      if (!response.headersSent) throw error
      if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined)
    }
  }

  @Head("download/:filename")
  checkDownloadBackup(
    @Param("filename") filename: string,
    @Res() response: Response,
  ) {
    response.set({
      "Content-Type": contentType(filename),
      "Content-Disposition": attachmentContentDisposition(filename),
    })
    response.end()
  }

  @Delete(":filename")
  async deleteBackup(@Param("filename") filename: string) {
    await this.backupService.deleteBackup(filename)
    return { ok: true }
  }

  private recordDownloadAudit(filename: string, request: AdminRequest | undefined, error?: unknown) {
    return this.auditLog?.record({
      adminEmail: request?.admin?.email ?? "",
      action: error ? "backup.download.failed" : "backup.download",
      targetType: "backup",
      targetId: filename,
      detail: {
        filename,
        ...(error ? { error: formatAuditError(error) } : {}),
      },
      ipAddress: request?.ip ?? "",
    })
  }
}

function contentType(filename: string): string {
  if (filename.endsWith(".tar")) return "application/x-tar"
  if (filename.endsWith(".gz")) return "application/gzip"
  return "application/octet-stream"
}
