import { Module } from "@nestjs/common"
import { APP_INTERCEPTOR } from "@nestjs/core"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AuditLogInterceptor } from "../common/audit-log.interceptor"
import { AuditLogService } from "../common/audit-log.service"
import { AdminController } from "./admin.controller"
import { AdminService } from "./admin.service"
import { LogFileController } from "./log-file.controller"
import { LogFileService } from "./log-file.service"

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminController, LogFileController],
  providers: [
    AdminService,
    AuditLogService,
    LogFileService,
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [AuditLogService],
})
export class AdminModule {}
