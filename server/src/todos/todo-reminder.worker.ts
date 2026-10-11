import { Injectable, Logger } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { PrismaService } from "../prisma/prisma.service"
import { NotificationService } from "../notifications/notification.service"
import { TodoRepository } from "./todo.repository"
import { TodoEvents } from "./todo-events"

const compensationMs = 24 * 60 * 60 * 1000
@Injectable()
export class TodoReminderWorker {
  private readonly logger = new Logger(TodoReminderWorker.name)
  private running = false
  constructor(private readonly prisma: PrismaService, private readonly repository: TodoRepository, private readonly notifications: NotificationService, private readonly events: TodoEvents) {}
  @Cron("*/30 * * * * *")
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try { await this.scanDue(new Date()) }
    catch (error) { this.logger.warn({ reason: error instanceof Error ? error.name : typeof error }, "Todo reminder scan failed") }
    finally { this.running = false }
  }
  async scanDue(now: Date): Promise<void> {
    const candidates = await this.prisma.todoItem.findMany({
      where: { reminderStatus: "pending", completedAt: null, deletedAt: null, remindAt: { lte: now } },
      orderBy: [{ remindAt: "asc" }, { id: "asc" }], take: 100,
    })
    for (const candidate of candidates) {
      const event = await this.repository.transaction(async (tx) => {
        const row = await this.repository.lock(tx, candidate.userId, candidate.id)
        if (!row || row.completedAt || row.reminderStatus !== "pending" || row.reminderGeneration !== candidate.reminderGeneration
          || !row.remindAt || row.remindAt > now || row.remindAt.getTime() !== candidate.remindAt?.getTime()) return null
        const expired = now.getTime() - row.remindAt.getTime() > compensationMs
        if (!expired) {
          const notification = await this.notifications.createInTransaction(tx, {
            userId: row.userId, source: "todo-reminder", sourceKey: `todo:${row.id}:${row.reminderGeneration}`,
            title: "待办提醒", body: row.title, targetId: row.id, url: `synapse://todos/${row.id}`, level: "active",
          })
          await tx.todoReminderDelivery.create({ data: { userId: row.userId, todoId: row.id, generation: row.reminderGeneration, notificationId: notification.id, remindAt: row.remindAt, nextAttemptAt: now } })
        }
        const updated = await tx.todoItem.update({ where: { id: row.id }, data: { reminderStatus: expired ? "expired" : "sent", version: { increment: 1 } } })
        return { userId: row.userId, payload: { id: row.id, version: updated.version } }
      })
      if (event) this.events.publish(event.userId, event.payload)
    }
  }
}
