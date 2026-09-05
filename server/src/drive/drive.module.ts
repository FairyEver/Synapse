import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaModule } from "../prisma/prisma.module"
import { DriveAdminController, DriveLocalStorageController, DrivePublicController, DriveUserController, PlatformMediaLocalStorageController } from "./drive.controller"
import { DriveAnnotationService } from "./drive-annotation.service"
import { DriveChangeLogService } from "./drive-change-log"
import { DriveDocumentHostedImageService } from "./drive-document-hosted-image.service"
import { DriveLinkIntakeService } from "./drive-link-intake.service"
import { DriveMarkdownProjectionService } from "./drive-markdown-projection.service"
import { DriveCollaborationGateway } from "./drive-collaboration.gateway"
import { DriveCollaborationService } from "./drive-collaboration.service"
import { LocalDriveCollaborationBus } from "./drive-collaboration-bus"
import { DriveLifecycleService } from "./drive-lifecycle.service"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import { DriveSiteService } from "./drive-site.service"
import { DriveService } from "./drive.service"
import { CosDriveStorage, LocalDriveStorage, shouldUseCosDriveStorage } from "./drive-storage"
import { PlatformMediaStorage } from "./platform-media-storage"

@Module({
  imports: [UserAuthModule, AdminAuthModule, PrismaModule],
  controllers: [DriveUserController, DriveAdminController, DrivePublicController, DriveLocalStorageController, PlatformMediaLocalStorageController],
  providers: [
    DriveLifecycleService,
    DriveChangeLogService,
    DriveAnnotationService,
    DriveMarkdownProjectionService,
    DriveCollaborationService,
    DriveCollaborationGateway,
    LocalDriveCollaborationBus,
    DriveDocumentHostedImageService,
    PlatformMediaStorage,
    DrivePublicAssetService,
    DriveSiteService,
    DriveService,
    {
      provide: DriveLinkIntakeService,
      useFactory: (
        drive: DriveService,
        sites: DriveSiteService,
        publicAssets: DrivePublicAssetService,
        storage: LocalDriveStorage | CosDriveStorage,
        annotations: DriveAnnotationService,
      ) => new DriveLinkIntakeService({
        drive,
        sites,
        publicAssets,
        storage,
        annotations,
        publicAppUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:3000",
      }),
      inject: [DriveService, DriveSiteService, DrivePublicAssetService, "DriveStoragePort", DriveAnnotationService],
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
  exports: ["DriveStoragePort", DriveService, DriveLifecycleService, DriveChangeLogService, DrivePublicAssetService, DriveSiteService, DriveAnnotationService, DriveMarkdownProjectionService, DriveCollaborationService, LocalDriveCollaborationBus, DriveDocumentHostedImageService, DriveLinkIntakeService],
})
export class DriveModule {}
