import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveController } from "./live.controller"
import { LiveDeviceService } from "./live-device.service"
import { LiveDesktopGateway } from "./live-desktop.gateway"
import { LiveQueryService } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"

@Module({
  imports: [AdminAuthModule, UserAuthModule, PrismaModule],
  controllers: [LiveController],
  providers: [
    LiveClientRegistry,
    LiveDeviceService,
    LiveDesktopGateway,
    LiveQueryService,
    LiveStreamService,
  ],
  exports: [LiveDesktopGateway, LiveDeviceService],
})
export class LiveModule {}
