import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PlatformMediaModule } from "../platform-media/platform-media.module"
import { PrismaModule } from "../prisma/prisma.module"
import { PublicAvatarController, ProfileAvatarController } from "./profile-avatar.controller"
import { ProfileAvatarService } from "./profile-avatar.service"

@Module({
  imports: [PrismaModule, UserAuthModule, PlatformMediaModule],
  controllers: [ProfileAvatarController, PublicAvatarController],
  providers: [ProfileAvatarService, AuditLogService],
})
export class ProfileAvatarModule {}
