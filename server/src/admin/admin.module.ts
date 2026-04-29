import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { AdminController } from "./admin.controller"
import { AdminService } from "./admin.service"

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
