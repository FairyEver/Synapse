import { Injectable, Logger, NotFoundException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { buildDriveDiscussionNotificationOpenUrl } from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"
import { NotificationService } from "../notifications/notification.service"
import { DRIVE_ITEM_LIFECYCLE_STATUS, DRIVE_STORAGE_STATUS } from "./drive.constants"
import { buildDriveDiscussionNotificationCopy, collectDriveDiscussionRecipients } from "./drive-discussion-notification-copy"
import type { DriveDiscussionDeliveryRef, DriveDiscussionEvent } from "./drive-discussion-notification.types"
import { measureAnnotationStage } from "./drive-annotation-diagnostics"

@Injectable()
export class DriveDiscussionNotificationService {
  private readonly logger = new Logger(DriveDiscussionNotificationService.name)
  private sink?: (ids: readonly string[], now: Date) => Promise<void>
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationService) {}
  setDeliverySink(sink: (ids: readonly string[], now: Date) => Promise<void>): void { this.sink = sink }

  async withItemLock<T>(itemId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const rows = await measureAnnotationStage("transaction.lock", () => tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "DriveItem" WHERE "id" = ${itemId}
            AND "deletedAt" IS NULL AND "storageStatus" = ${DRIVE_STORAGE_STATUS.active}
            AND "lifecycleStatus" = ${DRIVE_ITEM_LIFECYCLE_STATUS.active} FOR UPDATE`))
          if (!rows.length) throw new NotFoundException("文档不存在。")
          return work(tx)
        })
      } catch (error) {
        const abortedLock = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "40P01"))
        if (!abortedLock || attempt >= 2) throw error
      }
    }
  }
  async mutate<T>(itemId: string, work: (tx: Prisma.TransactionClient) => Promise<{ result: T; event: DriveDiscussionEvent }>): Promise<T> {
    const { result, refs } = await this.withItemLock(itemId, async (tx) => {
      const mutation = await work(tx)
      return { result: mutation.result, refs: await measureAnnotationStage("notifications.enqueue", () => this.enqueue(tx, mutation.event)) }
    })
    if (refs.length && this.sink) {
      void this.sink(refs.map((r) => r.notificationId), new Date()).catch(() => {
        this.logger.warn({ reason: "DELIVERY_FAILED" }, "Drive notification immediate delivery failed")
      })
    }
    return result
  }
  async enqueue(tx: Prisma.TransactionClient, event: DriveDiscussionEvent): Promise<DriveDiscussionDeliveryRef[]> {
    const recipients = collectDriveDiscussionRecipients(event)
    if (!recipients.length) return []
    const active = new Set((await tx.user.findMany({ where: { id: { in: recipients.map((r) => r.userId) }, status: "active" }, select: { id: true } })).map((u) => u.id))
    const refs: DriveDiscussionDeliveryRef[] = []
    for (const recipient of recipients) {
      if (!active.has(recipient.userId)) continue
      const copy = buildDriveDiscussionNotificationCopy(event, recipient)
      const notification = await this.notifications.createInTransaction(tx, {
        userId: recipient.userId, source: "drive-discussion", sourceKey: copy.sourceKey,
        title: copy.title, body: copy.body, level: "active", group: "drive",
      })
      const target = await tx.driveDiscussionNotificationTarget.upsert({
        where: { notificationId: notification.id }, update: {},
        create: { notificationId: notification.id, itemId: event.item.id, ...copy.meta,
          threadId: event.kind === "annotation" ? event.root.id : null,
          messageId: event.kind === "message" ? event.root.id : null,
          commentId: event.targetCommentId, sourceShareId: recipient.sourceShareId },
      })
      const url = buildDriveDiscussionNotificationOpenUrl(process.env.APP_PUBLIC_URL ?? "https://synapse.d2.pub", notification.id)
      await tx.userNotification.update({ where: { id: notification.id }, data: { targetId: target.id, url } })
      await tx.driveDiscussionNotificationDelivery.upsert({
        where: { notificationId: notification.id }, update: {},
        create: { notificationId: notification.id, userId: recipient.userId, nextAttemptAt: notification.createdAt },
      })
      refs.push({ userId: recipient.userId, notificationId: notification.id })
    }
    return refs
  }
}
