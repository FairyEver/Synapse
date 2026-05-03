import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { LicensesModule } from "../licenses/licenses.module"
import { AdminController } from "./admin.controller"
import { AdminService } from "./admin.service"

@Module({
  imports: [AdminAuthModule, LicensesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
