import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { DriveAdminController, DriveLocalStorageController, DrivePublicController, DriveUserController } from "./drive.controller"
import { DriveService } from "./drive.service"
import { CosDriveStorage, LocalDriveStorage, shouldUseCosDriveStorage } from "./drive-storage"

@Module({
  imports: [UserAuthModule, AdminAuthModule, PrismaModule],
  controllers: [DriveUserController, DriveAdminController, DrivePublicController, DriveLocalStorageController],
  providers: [
    DriveService,
    AuditLogService,
    CosDriveStorage,
    LocalDriveStorage,
    {
      provide: "DriveStoragePort",
      useFactory: (cos: CosDriveStorage, local: LocalDriveStorage) => shouldUseCosDriveStorage() ? cos : local,
      inject: [CosDriveStorage, LocalDriveStorage],
    },
  ],
  exports: [DriveService],
})
export class DriveModule {}
