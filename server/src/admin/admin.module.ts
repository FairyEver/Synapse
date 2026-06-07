import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { LiveModule } from "../live/live.module"
import { PermissionsModule } from "../permissions/permissions.module"
import { AdminController } from "./admin.controller"
import { AdminService } from "./admin.service"
import { LogFileController } from "./log-file.controller"
import { LogFileService } from "./log-file.service"

@Module({
  imports: [AdminAuthModule, PermissionsModule, LiveModule],
  controllers: [AdminController, LogFileController],
  providers: [
    AdminService,
    AuditLogService,
    LogFileService,
  ],
  exports: [AuditLogService],
})
export class AdminModule {}
