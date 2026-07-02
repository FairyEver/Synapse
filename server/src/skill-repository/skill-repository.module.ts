import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { SkillRepositoryController } from "./skill-repository.controller"
import { SKILL_REPOSITORY_STORAGE_PORT } from "./skill-repository.constants"
import { CosSkillRepositoryStorage, LocalSkillRepositoryStorage, shouldUseCosSkillRepositoryStorage } from "./skill-repository-storage"
import { SkillRepositoryService } from "./skill-repository.service"

@Module({
  imports: [UserAuthModule, AdminAuthModule, PrismaModule],
  controllers: [SkillRepositoryController],
  providers: [
    SkillRepositoryService,
    CosSkillRepositoryStorage,
    LocalSkillRepositoryStorage,
    {
      provide: SKILL_REPOSITORY_STORAGE_PORT,
      useFactory: (cos: CosSkillRepositoryStorage, local: LocalSkillRepositoryStorage) =>
        shouldUseCosSkillRepositoryStorage() ? cos : local,
      inject: [CosSkillRepositoryStorage, LocalSkillRepositoryStorage],
    },
  ],
  exports: [SkillRepositoryService],
})
export class SkillRepositoryModule {}
