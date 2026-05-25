import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { DashboardController } from "./dashboard.controller"

@Module({
  imports: [AdminAuthModule, UserAuthModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
