import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { InvitationsModule } from "../invitations/invitations.module"
import { PermissionsModule } from "../permissions/permissions.module"
import { PrismaModule } from "../prisma/prisma.module"
import { TeamsAuthGuard } from "./teams-auth.guard"
import { TeamsController } from "./teams.controller"
import { TeamsService } from "./teams.service"

@Module({
  imports: [PrismaModule, InvitationsModule, UserAuthModule, AdminAuthModule, PermissionsModule],
  controllers: [TeamsController],
  providers: [TeamsService, TeamsAuthGuard, AuditLogService],
  exports: [TeamsService],
})
export class TeamsModule {}
