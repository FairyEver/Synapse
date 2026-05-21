import { Module } from "@nestjs/common"
import { JwtModule } from "@nestjs/jwt"
import { loadEnv } from "../config/env"
import { PrismaModule } from "../prisma/prisma.module"
import { AdminAuthController } from "./admin-auth.controller"
import { AdminAuthGuard } from "./admin-auth.guard"
import { AdminAuthService } from "./admin-auth.service"
import { AdminBootstrapService, adminBootstrapEnvToken } from "./admin-bootstrap.service"

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv(process.env)
        return {
          secret: env.adminJwtSecret,
          signOptions: { expiresIn: "8h" },
        }
      },
    }),
  ],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    {
      provide: adminBootstrapEnvToken,
      useFactory: () => {
        const env = loadEnv(process.env)
        return { adminEmail: env.adminEmail, adminPassword: env.adminPassword }
      },
    },
    AdminBootstrapService,
    AdminAuthGuard,
  ],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
