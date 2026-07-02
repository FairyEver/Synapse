import { Module } from "@nestjs/common"
import { AdminAuthModule } from "../admin-auth/admin-auth.module"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { CONTENT_STORE_STORAGE_PORT } from "./content-store.constants"
import { ContentStoreAdminController, ContentStoreUserController } from "./content-store.controller"
import { ContentStoreService } from "./content-store.service"
import { CosContentStoreStorage, LocalContentStoreStorage, shouldUseCosContentStoreStorage } from "./content-store-storage"

@Module({
  imports: [UserAuthModule, AdminAuthModule, PrismaModule],
  controllers: [ContentStoreUserController, ContentStoreAdminController],
  providers: [
    ContentStoreService,
    CosContentStoreStorage,
    LocalContentStoreStorage,
    {
      provide: CONTENT_STORE_STORAGE_PORT,
      useFactory: (cos: CosContentStoreStorage, local: LocalContentStoreStorage) => shouldUseCosContentStoreStorage() ? cos : local,
      inject: [CosContentStoreStorage, LocalContentStoreStorage],
    },
  ],
  exports: [ContentStoreService, CONTENT_STORE_STORAGE_PORT],
})
export class ContentStoreModule {}
