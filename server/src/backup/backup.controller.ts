import { Controller, Delete, Get, InternalServerErrorException, Param, Post, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { pipeline } from "node:stream/promises"
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
    const stream = this.backupService.downloadBackup(filename)
    response.set({
      "Content-Type": contentType(filename),
      "Content-Disposition": contentDisposition(filename),
    })
    await pipeline(stream, response)
  }

  @Delete(":filename")
  async deleteBackup(@Param("filename") filename: string) {
    await this.backupService.deleteBackup(filename)
    return { ok: true }
  }
}

function contentType(filename: string): string {
  if (filename.endsWith(".tar")) return "application/x-tar"
  if (filename.endsWith(".gz")) return "application/gzip"
  return "application/octet-stream"
}

function contentDisposition(filename: string): string {
  const asciiFilename = filename.replace(/[^\x20-\x7E]|["\\;,\r\n]/g, "_")
  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}
