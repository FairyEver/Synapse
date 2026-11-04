import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { SkillHubController } from "./skill-hub.controller"
import { SkillHubService } from "./skill-hub.service"
import { SkillHubAdminController } from "./skill-hub-admin.controller"
import { SkillHubAdminService } from "./skill-hub-admin.service"
import { SkillHubBackupService } from "./skill-hub-backup.service"
import { SkillHubGcFence } from "./skill-hub-gc-fence"
import { SkillHubMaintenanceService } from "./skill-hub-maintenance.service"
import { createSkillHubStorage, SKILL_HUB_STORAGE } from "./skill-hub-storage"
import { SkillHubUploadController } from "./skill-hub-upload.controller"
import { SkillHubUploadService } from "./skill-hub-upload.service"
import { SkillHubTeamController } from "./skill-hub-team.controller"
import { SkillHubTeamService } from "./skill-hub-team.service"
import { SkillHubRepository } from "./skill-hub.repository"

@Module({
  imports: [PrismaModule, UserAuthModule, AdminAuthModule],
  controllers: [SkillHubTeamController, SkillHubUploadController, SkillHubController, SkillHubAdminController],
  providers: [
    SkillHubTeamService, SkillHubRepository, SkillHubUploadService, SkillHubMaintenanceService,
    SkillHubService, SkillHubAdminService, SkillHubBackupService, SkillHubGcFence, AuditLogService,
    { provide: SKILL_HUB_STORAGE, useFactory: createSkillHubStorage },
  ],
  exports: [SkillHubBackupService],
})
export class SkillHubModule {}
