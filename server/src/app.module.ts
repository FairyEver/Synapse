import { Module } from "@nestjs/common"
import { AdminModule } from "./admin/admin.module"
import { AdminAuthModule } from "./admin-auth/admin-auth.module"
import { LicensesModule } from "./licenses/licenses.module"
import { PrismaModule } from "./prisma/prisma.module"

@Module({
  imports: [PrismaModule, AdminAuthModule, AdminModule, LicensesModule],
})
export class AppModule {}
