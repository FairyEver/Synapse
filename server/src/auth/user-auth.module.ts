import { Module } from "@nestjs/common"
import { JwtModule } from "@nestjs/jwt"
import { AuditLogService } from "../common/audit-log.service"
import { loadEnv } from "../config/env"
import { PrismaModule } from "../prisma/prisma.module"
import { UserAuthController } from "./user-auth.controller"
import { UserAuthGuard } from "./user-auth.guard"
import { UserAuthService, userAuthOptionsToken } from "./user-auth.service"

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv(process.env)
        return { secret: env.userAccessJwtSecret }
      },
    }),
  ],
  controllers: [UserAuthController],
  providers: [
    {
      provide: userAuthOptionsToken,
      useFactory: () => {
        const env = loadEnv(process.env)
        return {
          accessMinutes: env.userAccessTokenMinutes,
          refreshDays: env.userRefreshTokenDays,
        }
      },
    },
    UserAuthService,
    UserAuthGuard,
    AuditLogService,
  ],
  exports: [UserAuthService, UserAuthGuard],
})
export class UserAuthModule {}
