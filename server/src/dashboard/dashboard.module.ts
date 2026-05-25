import { Module } from "@nestjs/common"
import { UserAuthModule } from "../auth/user-auth.module"
import { DashboardController } from "./dashboard.controller"

@Module({
  imports: [UserAuthModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
