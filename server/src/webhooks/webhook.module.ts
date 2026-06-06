import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { LiveModule } from "../live/live.module"
import { PrismaModule } from "../prisma/prisma.module"
import { WebhookDashboardController, WebhookPublicController } from "./webhook.controller"
import { WebhookService } from "./webhook.service"

@Module({
  imports: [UserAuthModule, AdminAuthModule, PrismaModule, LiveModule],
  controllers: [WebhookDashboardController, WebhookPublicController],
  providers: [WebhookService, AuditLogService],
  exports: [WebhookService],
})
export class WebhookModule {}
