import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { WebhookDashboardController } from "./webhook.controller"
import { WebhookService } from "./webhook.service"

@Module({
  imports: [UserAuthModule, PrismaModule],
  controllers: [WebhookDashboardController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
