import { Controller, Delete, Get, InternalServerErrorException, Param, Post, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { BackupService } from "./backup.service"

@Controller("/api/admin/backup")
@UseGuards(AdminAuthGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post()
  async triggerBackup() {
    const result = await this.backupService.performBackup()
    if (result.status === "failed") {
      throw new InternalServerErrorException(result.error ? `备份失败：${result.error}` : "备份失败。")
    }
    return result
  }

  @Get("list")
  async listBackups() {
    return this.backupService.listBackups()
  }

  @Get("download/:filename")
  async downloadBackup(@Param("filename") filename: string, @Res() response: Response) {
    const buffer = await this.backupService.downloadBackup(filename)
    response.set({
      "Content-Type": "application/gzip",
      "Content-Disposition": contentDisposition(filename),
      "Content-Length": buffer.length.toString(),
    })
    response.send(buffer)
  }

  @Delete(":filename")
  async deleteBackup(@Param("filename") filename: string) {
    await this.backupService.deleteBackup(filename)
    return { ok: true }
  }
}

function contentDisposition(filename: string): string {
  const asciiFilename = filename.replace(/[^\x20-\x7E]|["\\;,\r\n]/g, "_")
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}
