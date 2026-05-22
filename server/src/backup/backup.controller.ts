import { Controller, Get, Post, UseGuards } from "@nestjs/common"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { BackupService } from "./backup.service"

@Controller("dashboard/api/backup")
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
}
