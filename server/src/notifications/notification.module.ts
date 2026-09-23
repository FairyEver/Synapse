import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { ApiKeyModule } from "../api-keys/api-key.module"
import { LiveModule } from "../live/live.module"
import { MobileLiveModule } from "../mobile-live/mobile-live.module"
import { PrismaModule } from "../prisma/prisma.module"
import { NotificationController, OpenNotificationController } from "./notification.controller"
import { NotificationService } from "./notification.service"
import { OpenApiKeyGuard } from "../open-api/open-api-key.guard"
import { OpenApiExceptionFilter } from "../open-api/open-api-exception.filter"

@Module({
  imports: [PrismaModule, UserAuthModule, ApiKeyModule, LiveModule, MobileLiveModule],
  controllers: [NotificationController, OpenNotificationController],
  providers: [NotificationService, OpenApiKeyGuard, OpenApiExceptionFilter],
  exports: [NotificationService],
})
export class NotificationModule {}
