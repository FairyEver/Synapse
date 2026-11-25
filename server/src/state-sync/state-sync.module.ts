import { Module } from "@nestjs/common"
import { ApiKeyModule } from "../api-keys/api-key.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { StateSyncDebugTicketStore } from "./state-sync-debug-ticket"
import { StateSyncExceptionFilter, StateSyncGuard } from "./state-sync-http"
import { StateSyncHub } from "./state-sync-hub"
import { StateSyncController } from "./state-sync.controller"
import { StateSyncGateway } from "./state-sync.gateway"
import { StateSyncService } from "./state-sync.service"

@Module({
  imports: [PrismaModule, ApiKeyModule, UserAuthModule],
  controllers: [StateSyncController],
  providers: [
    StateSyncHub,
    StateSyncDebugTicketStore,
    StateSyncService,
    StateSyncGateway,
    StateSyncGuard,
    StateSyncExceptionFilter,
  ],
  exports: [StateSyncService, StateSyncHub, StateSyncGateway],
})
export class StateSyncModule {}
