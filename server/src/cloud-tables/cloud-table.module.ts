import { Module } from "@nestjs/common"
import { ApiKeyModule } from "../api-keys/api-key.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { CloudTableDatabase } from "./cloud-table-database"
import { CloudTableService } from "./cloud-table.service"
import { CloudTableController } from "./cloud-table.controller"
import { CloudTableGuard } from "./cloud-table-http"
import { OpenApiExceptionFilter } from "../open-api/open-api-exception.filter"
@Module({ imports: [ApiKeyModule, UserAuthModule], controllers: [CloudTableController], providers: [CloudTableDatabase, CloudTableService, CloudTableGuard, UserAuthGuard, OpenApiExceptionFilter], exports: [CloudTableService] })
export class CloudTableModule {}
