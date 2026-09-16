import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { LiveClientRegistry } from "../live/live-client-registry"
import { LiveModule } from "../live/live.module"
import { PrismaModule } from "../prisma/prisma.module"
import { MobileDeviceService } from "./mobile-device.service"
import { MobileLiveController } from "./mobile-live.controller"
import { MobileLiveGateway } from "./mobile-live.gateway"
import { MobileLiveRelayService } from "./mobile-live-relay.service"
import { MobilePushService } from "./mobile-push.service"
import {
  MOBILE_CLIENT_REGISTRY,
  MOBILE_LIVE_HEARTBEAT_TIMEOUT_MS,
} from "./mobile-live.types"

@Module({
  imports: [PrismaModule, UserAuthModule, LiveModule],
  controllers: [MobileLiveController],
  providers: [
    MobileLiveRelayService,
    MobileDeviceService,
    MobilePushService,
    MobileLiveGateway,
    {
      // A separate registry instance with the same state machine the desktop
      // channel already uses, so phones get identical supersede and staleness
      // behaviour without a second implementation to keep in step.
      provide: MOBILE_CLIENT_REGISTRY,
      useFactory: () => LiveClientRegistry.withOptions({
        heartbeatTimeoutMs: MOBILE_LIVE_HEARTBEAT_TIMEOUT_MS,
      }),
    },
  ],
  exports: [MobileLiveGateway, MobileLiveRelayService, MobileDeviceService, MobilePushService],
})
export class MobileLiveModule {}
