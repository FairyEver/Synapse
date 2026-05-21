import { Module } from "@nestjs/common"
import { JwtModule } from "@nestjs/jwt"
import { loadEnv } from "../config/env"
import { InvitationsModule } from "../invitations/invitations.module"
import { PrismaModule } from "../prisma/prisma.module"
import { UserAuthController } from "./user-auth.controller"
import { UserAuthGuard } from "./user-auth.guard"
import { UserAuthService, userAuthOptionsToken } from "./user-auth.service"

@Module({
  imports: [
    PrismaModule,
    InvitationsModule,
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
  ],
  exports: [UserAuthService, UserAuthGuard],
})
export class UserAuthModule {}
