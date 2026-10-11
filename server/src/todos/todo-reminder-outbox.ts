import { randomUUID } from "node:crypto"
import { Injectable, Logger } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import type { TodoReminderDelivery } from "@prisma/client"
import { PrismaService } from "../prisma/prisma.service"
import { NotificationService } from "../notifications/notification.service"

const dayMs = 86400000
export function todoDeliveryRetryDelay(attempt: number): number { return Math.min(900000, 60000 * 2 ** Math.min(10, Math.max(0, attempt - 1))) }
@Injectable()
export class TodoReminderOutbox {
  private readonly logger = new Logger(TodoReminderOutbox.name)
  private running = false
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationService) {}
  @Cron("*/30 * * * * *")
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try { await this.deliverPending(new Date()) }
    catch (error) { this.logger.warn({ reason: error instanceof Error ? error.name : typeof error }, "Todo outbox scan failed") }
    finally { this.running = false }
  }
  async deliverPending(now: Date): Promise<void> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<TodoReminderDelivery[]>`
        SELECT * FROM "TodoReminderDelivery" WHERE "status" = 'pending' AND "nextAttemptAt" <= ${now}
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${now})
        ORDER BY "nextAttemptAt", "id" LIMIT 100 FOR UPDATE SKIP LOCKED
      `
      return Promise.all(rows.map((row) => tx.todoReminderDelivery.update({ where: { id: row.id },
        data: { leaseUntil: new Date(now.getTime() + 60000), leaseToken: randomUUID(), attempts: { increment: 1 } } })))
    })
    for (const row of claimed) {
      const deadline = row.remindAt.getTime() + dayMs
      const notification = await this.prisma.userNotification.findFirst({ where: { id: row.notificationId, userId: row.userId } })
      let status: "delivered" | "skipped" | "expired" | "pending" = "delivered"
      let failureReason: string | null = null
      if (now.getTime() > deadline) { status = "expired"; failureReason = "DELIVERY_WINDOW_EXPIRED" }
      else if (!notification || notification.readAt || notification.deletedAt) status = "skipped"
      else {
        try { await this.notifications.deliverCommitted(row.userId, row.notificationId) }
        catch (error) {
          status = "pending"; failureReason = "DELIVERY_FAILED"
          this.logger.warn({ userId: row.userId, todoId: row.todoId, notificationId: row.notificationId, attempt: row.attempts, reason: error instanceof Error ? error.name : typeof error }, "Todo notification delivery failed")
        }
      }
      await this.prisma.todoReminderDelivery.updateMany({ where: { id: row.id, leaseToken: row.leaseToken }, data: {
        status, failureReason, leaseUntil: null, leaseToken: null,
        nextAttemptAt: new Date(Math.min(deadline + 1, now.getTime() + todoDeliveryRetryDelay(row.attempts))),
      } })
    }
  }
  @Cron("0 5 3 * * *")
  async prune(): Promise<void> {
    const now = new Date()
    await this.prisma.todoMutationReceipt.deleteMany({ where: { expiresAt: { lte: now } } })
    await this.prisma.todoReminderDelivery.deleteMany({ where: { status: { not: "pending" }, createdAt: { lt: new Date(now.getTime() - 90 * dayMs) } } })
    await this.prisma.todoItem.deleteMany({ where: { deletedAt: { lt: new Date(now.getTime() - 90 * dayMs) } } })
  }
}
