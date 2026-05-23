import { Controller, Delete, Get, Param, Post, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { BackupService } from "./backup.service"

@Controller("/api/admin/backup")
@UseGuards(AdminAuthGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post()
  async triggerBackup() {
    return this.backupService.performBackup()
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
      "Content-Disposition": `attachment; filename="${filename}"`,
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
