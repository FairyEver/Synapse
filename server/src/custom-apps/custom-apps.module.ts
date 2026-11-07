import { Module } from "@nestjs/common"

import { UserAuthModule } from "../auth/user-auth.module"
import { PlatformMediaModule } from "../platform-media/platform-media.module"
import { PrismaModule } from "../prisma/prisma.module"
import { CustomAppIconsService } from "./custom-app-icons.service"
import { CustomAppIconsController, CustomAppsController } from "./custom-apps.controller"
import { CustomAppsService } from "./custom-apps.service"

@Module({
  imports: [PrismaModule, UserAuthModule, PlatformMediaModule],
  controllers: [CustomAppsController, CustomAppIconsController],
  providers: [CustomAppsService, CustomAppIconsService],
  exports: [CustomAppsService, CustomAppIconsService],
})
export class CustomAppsModule {}
