import { Module } from "@nestjs/common"
import { loadEnv } from "../config/env"
import { AdminAuthController } from "./admin-auth.controller"
import { AdminAuthGuard } from "./admin-auth.guard"
import { AdminAuthService } from "./admin-auth.service"

@Module({
  controllers: [AdminAuthController],
  providers: [
    {
      provide: AdminAuthService,
      useFactory: async () => {
        const env = loadEnv(process.env)
        return AdminAuthService.create({
          email: env.adminEmail,
          password: env.adminPassword,
          jwtSecret: env.adminJwtSecret,
        })
      },
    },
    AdminAuthGuard,
  ],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
