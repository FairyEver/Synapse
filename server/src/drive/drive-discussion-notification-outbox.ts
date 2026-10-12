import { randomUUID } from "node:crypto"
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma, type DriveDiscussionNotificationDelivery } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import { NotificationService } from "../notifications/notification.service"
import { DriveDiscussionNotificationService } from "./drive-discussion-notification.service"

const dayMs = 86400000
export function driveDiscussionRetryDelay(attempt: number): number {
  return Math.min(900000, 60000 * 2 ** Math.min(10, Math.max(0, attempt - 1)))
}

@Injectable()
export class DriveDiscussionNotificationOutbox implements OnModuleInit {
  private readonly logger = new Logger(DriveDiscussionNotificationOutbox.name)
  private running = false
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly discussion: DriveDiscussionNotificationService,
  ) {}

  onModuleInit(): void {
    this.discussion.setDeliverySink((ids, now) => this.deliverIds(ids, now))
  }

  @Cron("*/30 * * * * *")
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try { await this.deliverPending(new Date()) }
    catch (error) { this.logger.warn({ reason: error instanceof Error ? error.name : typeof error }, "Drive discussion outbox scan failed") }
    finally { this.running = false }
  }

  deliverPending(now: Date): Promise<void> { return this.deliver(now) }
  deliverIds(ids: readonly string[], now: Date): Promise<void> {
    if (!ids.length) return Promise.resolve()
    return this.deliver(now, ids)
  }

  private async deliver(now: Date, ids?: readonly string[]): Promise<void> {
    const startedAt = Date.now()
    const currentTime = () => new Date(now.getTime() + Math.max(0, Date.now() - startedAt))
    const claimed = await this.prisma.$transaction(async (tx) => {
      const filter = ids ? Prisma.sql`AND "notificationId" IN (${Prisma.join(ids)})` : Prisma.empty
      const rows = await tx.$queryRaw<DriveDiscussionNotificationDelivery[]>(Prisma.sql`
        SELECT * FROM "DriveDiscussionNotificationDelivery"
        WHERE "status" = 'pending' AND "nextAttemptAt" <= ${now}
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${now}) ${filter}
        ORDER BY "nextAttemptAt", "id" LIMIT 100 FOR UPDATE SKIP LOCKED
      `)
      return Promise.all(rows.map((row) => tx.driveDiscussionNotificationDelivery.update({
        where: { id: row.id },
        data: { leaseUntil: new Date(now.getTime() + 60000), leaseToken: randomUUID(), attempts: { increment: 1 } },
      })))
    })
    for (const row of claimed) {
      const notification = await this.prisma.userNotification.findFirst({ where: { id: row.notificationId, userId: row.userId } })
      if (!(await this.renewLease(row, currentTime())).count) continue
      const deadline = row.createdAt.getTime() + dayMs
      let status: "delivered" | "skipped" | "expired" | "pending" = "delivered"
      let failureReason: string | null = null
      if (currentTime().getTime() >= deadline) { status = "expired"; failureReason = "DELIVERY_WINDOW_EXPIRED" }
      else if (!notification || notification.readAt || notification.deletedAt) status = "skipped"
      else {
        try { await this.deliverWhileLeased(row, currentTime) }
        catch (error) {
          status = "pending"; failureReason = "DELIVERY_FAILED"
          if (currentTime().getTime() >= deadline) { status = "expired"; failureReason = "DELIVERY_WINDOW_EXPIRED" }
          this.logger.warn({ userId: row.userId, notificationId: row.notificationId, attempt: row.attempts, reason: error instanceof Error ? error.name : typeof error }, "Drive discussion notification delivery failed")
        }
      }
      await this.prisma.driveDiscussionNotificationDelivery.updateMany({
        where: { id: row.id, leaseToken: row.leaseToken },
        data: { status, failureReason, leaseUntil: null, leaseToken: null,
          nextAttemptAt: new Date(Math.min(deadline + 1, currentTime().getTime() + driveDiscussionRetryDelay(row.attempts))) },
      })
    }
  }

  private renewLease(row: DriveDiscussionNotificationDelivery, now: Date) {
    return this.prisma.driveDiscussionNotificationDelivery.updateMany({
      where: { id: row.id, status: "pending", leaseToken: row.leaseToken, leaseUntil: { gt: now } },
      data: { leaseUntil: new Date(now.getTime() + 60000) },
    })
  }

  private async deliverWhileLeased(row: DriveDiscussionNotificationDelivery, currentTime: () => Date): Promise<void> {
    const controller = new AbortController()
    const expires = setTimeout(() => controller.abort(), Math.max(0, row.createdAt.getTime() + dayMs - currentTime().getTime()))
    let renewing: Promise<void> | undefined
    const heartbeat = setInterval(() => {
      if (renewing) return
      renewing = this.renewLease(row, currentTime()).then(({ count }) => {
        if (!count) controller.abort()
      }).catch((error: unknown) => {
        controller.abort()
        this.logger.warn({ notificationId: row.notificationId, reason: error instanceof Error ? error.name : typeof error }, "Drive discussion delivery lease renewal failed")
      }).finally(() => { renewing = undefined })
    }, 20000)
    try { await this.notifications.deliverCommitted(row.userId, row.notificationId, controller.signal) }
    finally { clearTimeout(expires); clearInterval(heartbeat); await renewing }
  }

  @Cron("0 5 3 * * *")
  async prune(): Promise<void> {
    await this.prisma.driveDiscussionNotificationDelivery.deleteMany({
      where: { status: { not: "pending" }, createdAt: { lt: new Date(Date.now() - 90 * dayMs) } },
    })
  }
}
