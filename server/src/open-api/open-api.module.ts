import { Module } from "@nestjs/common"
import { ApiKeyModule } from "../api-keys/api-key.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { DriveModule } from "../drive/drive.module"
import { PrismaModule } from "../prisma/prisma.module"
import { OpenApiDownloadController } from "./open-api-download.controller"
import { OpenApiDownloadGrantService } from "./open-api-download-grant.service"
import { OpenApiContractController } from "./open-api-contract.controller"
import { OpenApiExceptionFilter } from "./open-api-exception.filter"
import { OpenApiKeyGuard } from "./open-api-key.guard"
import { OpenApiShareLinkDownloadService } from "./open-api-share-link-download.service"
import { OpenApiUsageLogService } from "./open-api-usage-log.service"
import { OpenApiUsageController } from "./open-api-usage.controller"
import { OpenApiController } from "./open-api.controller"

@Module({
  imports: [ApiKeyModule, UserAuthModule, DriveModule, PrismaModule],
  controllers: [OpenApiContractController, OpenApiController, OpenApiDownloadController, OpenApiUsageController],
  providers: [
    OpenApiKeyGuard,
    OpenApiExceptionFilter,
    OpenApiShareLinkDownloadService,
    OpenApiDownloadGrantService,
    OpenApiUsageLogService,
  ],
})
export class OpenApiModule {}
