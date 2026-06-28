import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { DriveAdminController, DriveLocalStorageController, DrivePublicController, DriveUserController } from "./drive.controller"
import { DriveAnnotationService } from "./drive-annotation.service"
import { DriveDocumentImageService } from "./drive-document-image.service"
import { DriveLinkIntakeService } from "./drive-link-intake.service"
import { DriveLifecycleService } from "./drive-lifecycle.service"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import { DriveRemoteImageFetcher } from "./drive-remote-image-fetcher"
import { DriveSiteService } from "./drive-site.service"
import { DriveService } from "./drive.service"
import { CosDriveStorage, LocalDriveStorage, shouldUseCosDriveStorage } from "./drive-storage"

@Module({
  imports: [UserAuthModule, AdminAuthModule, PrismaModule],
  controllers: [DriveUserController, DriveAdminController, DrivePublicController, DriveLocalStorageController],
  providers: [
    DriveLifecycleService,
    DriveAnnotationService,
    DriveDocumentImageService,
    DrivePublicAssetService,
    DriveRemoteImageFetcher,
    DriveSiteService,
    DriveService,
    {
      provide: DriveLinkIntakeService,
      useFactory: (
        drive: DriveService,
        sites: DriveSiteService,
        publicAssets: DrivePublicAssetService,
        storage: LocalDriveStorage | CosDriveStorage,
      ) => new DriveLinkIntakeService({
        drive,
        sites,
        publicAssets,
        storage,
        publicAppUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
      }),
      inject: [DriveService, DriveSiteService, DrivePublicAssetService, "DriveStoragePort"],
    },
    AuditLogService,
    CosDriveStorage,
    LocalDriveStorage,
    {
      provide: "DriveStoragePort",
      useFactory: (cos: CosDriveStorage, local: LocalDriveStorage) => shouldUseCosDriveStorage() ? cos : local,
      inject: [CosDriveStorage, LocalDriveStorage],
    },
  ],
  exports: [DriveService, DriveLifecycleService, DrivePublicAssetService, DriveSiteService, DriveAnnotationService, DriveDocumentImageService, DriveLinkIntakeService],
})
export class DriveModule {}
