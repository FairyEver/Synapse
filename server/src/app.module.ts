import { Module } from "@nestjs/common"
import { LicensesModule } from "./licenses/licenses.module"
import { PrismaModule } from "./prisma/prisma.module"

@Module({
  imports: [PrismaModule, LicensesModule],
})
export class AppModule {}
