import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { ContentStoreModule } from "../content-store/content-store.module"
import { PrismaModule } from "../prisma/prisma.module"
import { SkillRepositoryController } from "./skill-repository.controller"
import { SkillRepositoryService } from "./skill-repository.service"

@Module({
  imports: [UserAuthModule, PrismaModule, ContentStoreModule],
  controllers: [SkillRepositoryController],
  providers: [SkillRepositoryService],
  exports: [SkillRepositoryService],
})
export class SkillRepositoryModule {}
