import { Injectable } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import { PinoLogger } from "nestjs-pino"
import { loadEnv } from "../config/env"
import { PrismaService } from "../prisma/prisma.service"

@Injectable()
export class CleanupService {
  private readonly retentionDays: number

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.retentionDays = loadEnv(process.env).activationAttemptRetentionDays
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredAttempts(): Promise<void> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000)
    const start = Date.now()

    const result = await this.prisma.activationAttempt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })

    this.logger.info(
      { deleted: result.count, durationMs: Date.now() - start },
      "Cleaned up expired activation attempts",
    )
  }
}
