import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import {
  ClientTelemetryAdminController,
  ClientTelemetryController,
} from "./client-telemetry.controller"
import { ClientTelemetryRetentionService } from "./client-telemetry-retention.service"
import { ClientTelemetryService } from "./client-telemetry.service"

@Module({
  imports: [AdminAuthModule, UserAuthModule],
  controllers: [ClientTelemetryController, ClientTelemetryAdminController],
  providers: [AuditLogService, ClientTelemetryRetentionService, ClientTelemetryService],
})
export class ClientTelemetryModule {}
