import { Module } from "@nestjs/common"

import { UserAuthModule } from "../auth/user-auth.module"
import { LiveModule } from "../live/live.module"
import { PlatformMediaModule } from "../platform-media/platform-media.module"
import { PrismaModule } from "../prisma/prisma.module"
import { CustomAppIconsService } from "./custom-app-icons.service"
import { CustomAppEvents } from "./custom-app-events"
import { CustomAppIconsController, CustomAppsController } from "./custom-apps.controller"
import { CustomAppsService } from "./custom-apps.service"

@Module({
  imports: [PrismaModule, UserAuthModule, PlatformMediaModule, LiveModule],
  controllers: [CustomAppsController, CustomAppIconsController],
  providers: [CustomAppsService, CustomAppIconsService, CustomAppEvents],
  exports: [CustomAppsService, CustomAppIconsService, CustomAppEvents],
})
export class CustomAppsModule {}
