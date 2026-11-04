import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { SkillHubModule } from "../skill-hub/skill-hub.module"
import { BackupController } from "./backup.controller"
import { BackupService } from "./backup.service"

@Module({
  imports: [AdminAuthModule, PrismaModule, SkillHubModule],
  controllers: [BackupController],
  providers: [BackupService, AuditLogService],
  exports: [BackupService],
})
export class BackupModule {}
