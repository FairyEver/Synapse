import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveController } from "./live.controller"
import { LiveDesktopGateway } from "./live-desktop.gateway"
import { LiveQueryService } from "./live-query.service"
import { LiveStreamService } from "./live-stream.service"

@Module({
  imports: [AdminAuthModule, UserAuthModule],
  controllers: [LiveController],
  providers: [
    LiveClientRegistry,
    LiveDesktopGateway,
    LiveQueryService,
    LiveStreamService,
  ],
  exports: [LiveDesktopGateway],
})
export class LiveModule {}
