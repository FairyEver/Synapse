import { Module } from "@nestjs/common"
import { ApiKeyModule } from "../api-keys/api-key.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { OpenApiExceptionFilter } from "../open-api/open-api-exception.filter"
import { PrismaModule } from "../prisma/prisma.module"
import { ChannelDebugTicketStore } from "./channel-debug-ticket"
import { ChannelGateway } from "./channel.gateway"
import { ChannelGuard } from "./channel-http"
import { ChannelHub } from "./channel-hub"
import { ChannelController } from "./channel.controller"
import { ChannelService } from "./channel.service"

@Module({
  imports: [PrismaModule, ApiKeyModule, UserAuthModule],
  controllers: [ChannelController],
  providers: [ChannelHub, ChannelDebugTicketStore, ChannelService, ChannelGateway, ChannelGuard, OpenApiExceptionFilter],
  exports: [ChannelService, ChannelHub, ChannelGateway],
})
export class ChannelModule {}
