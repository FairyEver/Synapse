import { Module } from "@nestjs/common"
import { loadEnv } from "../config/env"
import { PrismaService } from "../prisma/prisma.service"
import { LicensesController } from "./licenses.controller"
import { LicensesService } from "./licenses.service"

@Module({
  controllers: [LicensesController],
  providers: [{
    provide: LicensesService,
    inject: [PrismaService],
    useFactory: (prisma: PrismaService) => {
      const env = loadEnv(process.env)
      return LicensesService.createWithPrisma({
        privateKey: env.licensePrivateKey,
        publicKey: env.licensePublicKey,
        keyId: env.licenseKeyId,
        leaseDays: env.licenseLeaseDays,
      }, prisma)
    },
  }],
  exports: [LicensesService],
})
export class LicensesModule {}
