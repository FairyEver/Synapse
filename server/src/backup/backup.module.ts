import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { BackupController } from "./backup.controller"
import { BackupService } from "./backup.service"

@Module({
  imports: [AdminAuthModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
