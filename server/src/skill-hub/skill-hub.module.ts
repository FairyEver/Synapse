import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { SkillHubMaintenanceService } from "./skill-hub-maintenance.service"
import { createSkillHubStorage, SKILL_HUB_STORAGE } from "./skill-hub-storage"
import { SkillHubUploadController } from "./skill-hub-upload.controller"
import { SkillHubUploadService } from "./skill-hub-upload.service"
import { SkillHubTeamController } from "./skill-hub-team.controller"
import { SkillHubTeamService } from "./skill-hub-team.service"
import { SkillHubRepository } from "./skill-hub.repository"

@Module({
  imports: [PrismaModule, UserAuthModule],
  controllers: [SkillHubTeamController, SkillHubUploadController],
  providers: [
    SkillHubTeamService, SkillHubRepository, SkillHubUploadService, SkillHubMaintenanceService,
    { provide: SKILL_HUB_STORAGE, useFactory: createSkillHubStorage },
  ],
})
export class SkillHubModule {}
