import { Injectable } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import { CLIENT_TELEMETRY_RETENTION_DAYS } from "./client-telemetry.constants"

const cleanupBatchSize = 10_000
const maximumCleanupBatches = 20

@Injectable()
export class ClientTelemetryRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron("17 4 * * *", { timeZone: "Asia/Shanghai" })
  async deleteExpired(): Promise<number> {
    let deleted = 0
    for (let batch = 0; batch < maximumCleanupBatches; batch += 1) {
      const result = await this.prisma.$executeRaw(Prisma.sql`
        WITH expired AS (
          SELECT "eventId"
          FROM "ClientTelemetryEvent"
          WHERE "occurredAt" < CURRENT_TIMESTAMP - make_interval(days => ${CLIENT_TELEMETRY_RETENTION_DAYS})
          ORDER BY "occurredAt" ASC
          LIMIT ${cleanupBatchSize}
        )
        DELETE FROM "ClientTelemetryEvent" event
        USING expired
        WHERE event."eventId" = expired."eventId"
      `)
      deleted += result
      if (result < cleanupBatchSize) break
    }
    return deleted
  }
}
