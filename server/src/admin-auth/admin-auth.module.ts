import { Module } from "@nestjs/common"
import { loadEnv } from "../config/env"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { AdminAuthController } from "./admin-auth.controller"
import { AdminAuthGuard } from "./admin-auth.guard"
import { AdminAuthService, adminAuthOptionsToken } from "./admin-auth.service"

@Module({
  imports: [PrismaModule],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    {
      provide: adminAuthOptionsToken,
      useFactory: () => {
        const env = loadEnv(process.env)
        return { accessSecret: env.adminAccessSecret }
      },
    },
    AdminAuthGuard,
    AuditLogService,
  ],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
