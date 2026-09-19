import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { TeamController } from "./team.controller"
import { TeamService } from "./team.service"

@Module({
  imports: [PrismaModule, AdminAuthModule],
  controllers: [TeamController],
  providers: [TeamService, AuditLogService],
})
export class TeamModule {}
