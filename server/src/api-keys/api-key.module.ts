import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { ApiKeyController } from "./api-key.controller"
import { ApiKeyService } from "./api-key.service"

@Module({
  imports: [UserAuthModule, PrismaModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService, AuditLogService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
