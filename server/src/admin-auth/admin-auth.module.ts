import { Module } from "@nestjs/common"
import { JwtModule, JwtService } from "@nestjs/jwt"
import bcrypt from "bcryptjs"
import { loadEnv } from "../config/env"
import { AdminAuthController } from "./admin-auth.controller"
import { AdminAuthGuard } from "./admin-auth.guard"
import { AdminAuthService } from "./admin-auth.service"

@Module({
  imports: [
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
    {
      provide: AdminAuthService,
      useFactory: async (jwt: JwtService) => {
        const env = loadEnv(process.env)
        const passwordHash = await bcrypt.hash(env.adminPassword, 10)
        return new AdminAuthService(jwt, env.adminEmail.toLowerCase(), passwordHash)
      },
      inject: [JwtService],
    },
    AdminAuthGuard,
  ],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
