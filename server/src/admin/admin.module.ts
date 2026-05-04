import { Module } from "@nestjs/common"
import { APP_INTERCEPTOR } from "@nestjs/core"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AuditLogInterceptor } from "../common/audit-log.interceptor"
import { AuditLogService } from "../common/audit-log.service"
import { LicensesModule } from "../licenses/licenses.module"
import { AdminController } from "./admin.controller"
import { AdminService } from "./admin.service"

@Module({
  imports: [AdminAuthModule, LicensesModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AuditLogService,
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
  exports: [AuditLogService],
})
export class AdminModule {}
