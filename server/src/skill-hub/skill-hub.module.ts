import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { SkillHubTeamController } from "./skill-hub-team.controller"
import { SkillHubTeamService } from "./skill-hub-team.service"
import { SkillHubRepository } from "./skill-hub.repository"

@Module({
  imports: [PrismaModule, UserAuthModule],
  controllers: [SkillHubTeamController],
  providers: [SkillHubTeamService, SkillHubRepository],
})
export class SkillHubModule {}
