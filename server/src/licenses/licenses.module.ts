import { Module } from "@nestjs/common"
import { loadEnv } from "../config/env"
import { PrismaService } from "../prisma/prisma.service"
import { ActivationRiskService } from "./activation-risk.service"
import { LicensesController } from "./licenses.controller"
import { LicensesService } from "./licenses.service"

@Module({
  controllers: [LicensesController],
  providers: [
    {
      provide: ActivationRiskService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const env = loadEnv(process.env)
        return new ActivationRiskService(prisma, {
          attemptRetentionDays: env.activationAttemptRetentionDays,
          rateWindowMinutes: env.activationRateWindowMinutes,
          rateMaxFailuresPerIp: env.activationRateMaxFailuresPerIp,
          rateMaxFailuresPerEmail: env.activationRateMaxFailuresPerEmail,
          rateMaxFailuresPerDevice: env.activationRateMaxFailuresPerDevice,
          riskWindowMinutes: env.activationRiskWindowMinutes,
          riskMaxDistinctIpsPerCode: env.activationRiskMaxDistinctIpsPerCode,
          riskMaxDistinctEmailsPerCode: env.activationRiskMaxDistinctEmailsPerCode,
          riskMaxDistinctDevicesPerCode: env.activationRiskMaxDistinctDevicesPerCode,
          riskMaxBoundConflictsPerCode: env.activationRiskMaxBoundConflictsPerCode,
        })
      },
    },
    {
      provide: LicensesService,
      inject: [PrismaService, ActivationRiskService],
      useFactory: (prisma: PrismaService, risk: ActivationRiskService) => {
        const env = loadEnv(process.env)
        return LicensesService.createWithPrisma({
          privateKey: env.licensePrivateKey,
          publicKey: env.licensePublicKey,
          keyId: env.licenseKeyId,
          leaseDays: env.licenseLeaseDays,
        }, prisma, risk)
      },
    },
  ],
  exports: [LicensesService, ActivationRiskService],
})
export class LicensesModule {}
