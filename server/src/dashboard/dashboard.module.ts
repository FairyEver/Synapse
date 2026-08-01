import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { DashboardAuthController } from "./dashboard-auth.controller"
import { DashboardController } from "./dashboard.controller"

@Module({
  imports: [UserAuthModule],
  controllers: [DashboardAuthController, DashboardController],
})
export class DashboardModule {}
