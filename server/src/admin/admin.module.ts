import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { InvitationsModule } from "../invitations/invitations.module"
import { AdminController } from "./admin.controller"
import { AdminService } from "./admin.service"
import { LogFileController } from "./log-file.controller"
import { LogFileService } from "./log-file.service"

@Module({
  imports: [AdminAuthModule, InvitationsModule],
  controllers: [AdminController, LogFileController],
  providers: [
    AdminService,
    AuditLogService,
    LogFileService,
  ],
  exports: [AuditLogService],
})
export class AdminModule {}
