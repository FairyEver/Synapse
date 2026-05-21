import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { InvitationsModule } from "../invitations/invitations.module"
import { PrismaModule } from "../prisma/prisma.module"
import { TeamsController } from "./teams.controller"
import { TeamsService } from "./teams.service"

@Module({
  imports: [PrismaModule, InvitationsModule, UserAuthModule],
  controllers: [TeamsController],
  providers: [TeamsService, AuditLogService],
  exports: [TeamsService],
})
export class TeamsModule {}
