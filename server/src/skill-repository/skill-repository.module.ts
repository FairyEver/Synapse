import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { ContentStoreModule } from "../content-store/content-store.module"
import { PrismaModule } from "../prisma/prisma.module"
import { SkillRepositoryController } from "./skill-repository.controller"
import { SkillRepositoryLegacyMigrationService } from "./skill-repository-legacy-migration.service"
import { SkillRepositoryService } from "./skill-repository.service"

@Module({
  imports: [UserAuthModule, PrismaModule, ContentStoreModule],
  controllers: [SkillRepositoryController],
  providers: [SkillRepositoryService, SkillRepositoryLegacyMigrationService],
  exports: [SkillRepositoryService, SkillRepositoryLegacyMigrationService],
})
export class SkillRepositoryModule {}
