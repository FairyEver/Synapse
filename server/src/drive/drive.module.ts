import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { DriveAdminController, DrivePublicController, DriveUserController } from "./drive.controller"
import { DriveService } from "./drive.service"
import { CosDriveStorage } from "./drive-storage"

@Module({
  imports: [UserAuthModule, AdminAuthModule, PrismaModule],
  controllers: [DriveUserController, DriveAdminController, DrivePublicController],
  providers: [
    DriveService,
    AuditLogService,
    CosDriveStorage,
    { provide: "DriveStoragePort", useExisting: CosDriveStorage },
  ],
  exports: [DriveService],
})
export class DriveModule {}
