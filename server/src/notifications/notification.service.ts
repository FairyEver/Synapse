import { randomUUID } from "node:crypto"
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma, type UserNotification } from "@prisma/client"
import { LIVE_MESSAGE_TYPES, createLiveEnvelope, type NotificationSource, type DriveDiscussionNotificationMetadata, parseDriveDiscussionNotificationSnapshot } from "@synapse/shared"
import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { MobileLiveGateway } from "../mobile-live/mobile-live.gateway"
import { MobilePushService } from "../mobile-live/mobile-push.service"
import { MobileLiveRelayService } from "../mobile-live/mobile-live-relay.service"
import { PrismaService } from "../prisma/prisma.service"

export type NotificationLevel = "active" | "passive" | "timeSensitive"
export type { NotificationSource } from "@synapse/shared"

export type CreateNotificationInput = {
  userId: string
  source: NotificationSource
  sourceKey?: string
  title: string
  body: string
  group?: string
  url?: string
  copyOnTap?: boolean
  level?: NotificationLevel
  targetId?: string
  deviceId?: string
}

const retentionMs = 90 * 24 * 60 * 60 * 1000

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly desktops: LiveDesktopGateway,
    private readonly mobiles: MobileLiveGateway,
    private readonly push: MobilePushService,
    private readonly relay: MobileLiveRelayService,
  ) {}

  onModuleInit(): void {
    this.relay.setNotificationSink(this)
  }

  /** Storage only. Caller owns the transaction and post-commit delivery. */
  createInTransaction(tx: Prisma.TransactionClient, input: CreateNotificationInput & { sourceKey: string }): Promise<UserNotification> {
    return tx.userNotification.upsert({
      where: { userId_sourceKey: { userId: input.userId, sourceKey: input.sourceKey } },
      update: {},
      create: { userId: input.userId, source: input.source, sourceKey: input.sourceKey, title: input.title.slice(0, 64),
        body: input.body.slice(0, 512), group: input.group, url: input.url, copyOnTap: input.copyOnTap,
        level: input.level ?? "active", targetId: input.targetId, deviceId: input.deviceId },
    })
  }

  /** Retry delivery of an existing record; never create another notification. */
  async deliverCommitted(userId: string, notificationId: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const record = await this.get(userId, notificationId)
    signal?.throwIfAborted()
    if (!record || record.readAt || record.deletedAt) return
    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.notificationChanged, { notificationId }, { id: randomUUID(), sentAt: new Date().toISOString() })
    const result = this.desktops.broadcastToUser(userId, message)
    this.mobiles.sendToMobileClients({ userId, message })
    if (result?.failedClientCount > 0) throw new Error("NOTIFICATION_LIVE_DELIVERY_FAILED")
    if (record.level === "passive") return
    const outcome = await this.push.sendNotification(userId, { id: record.id, title: record.title, body: record.body, level: record.level as NotificationLevel, group: record.group, copyOnTap: record.copyOnTap }, signal)
    if (outcome.failed > 0 || outcome.skipped) throw new Error("NOTIFICATION_PUSH_DELIVERY_FAILED")
  }

  async create(input: CreateNotificationInput): Promise<UserNotification> {
    if (input.source === "terminal-attention" && input.deviceId && input.targetId) {
      const pending = await this.prisma.userNotification.findFirst({
        where: { userId: input.userId, source: "terminal-attention", deviceId: input.deviceId, targetId: input.targetId, resolvedAt: null, deletedAt: null },
      })
      if (pending) return pending
    }
    let record: UserNotification
    try {
      record = await this.prisma.userNotification.create({
        data: {
          userId: input.userId,
          source: input.source,
          sourceKey: input.sourceKey,
          title: input.title.slice(0, 64),
          body: input.body.slice(0, 512),
          group: input.group,
          url: input.url,
          copyOnTap: input.copyOnTap,
          level: input.level ?? "active",
          targetId: input.targetId,
          deviceId: input.deviceId,
        },
      })
    } catch (error) {
      if (input.sourceKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await this.prisma.userNotification.findUnique({
          where: { userId_sourceKey: { userId: input.userId, sourceKey: input.sourceKey } },
        })
        if (existing) return existing
      }
      throw error
    }
    this.publish(input.userId, record.id)
    if (record.level !== "passive") {
      const delivery = record.source === "terminal-attention" && record.deviceId && record.targetId
        ? this.push.sendTerminalApproval(input.userId, {
          title: record.title,
          body: record.body,
          desktopClientInstanceId: record.deviceId,
          sessionId: record.targetId,
          sessionTitle: record.title,
          detail: "",
          notificationId: record.id,
        })
        : this.push.sendNotification(input.userId, {
          id: record.id,
          title: record.title,
          body: record.body,
          level: record.level as NotificationLevel,
          group: record.group,
          copyOnTap: record.copyOnTap,
        })
      void delivery.catch((error: unknown) => {
        this.logger.warn({ reason: error instanceof Error ? error.name : typeof error }, "Notification APNs delivery failed")
      })
    }
    return record
  }

  async list(userId: string, input: { cursor?: string; filter?: "all" | "unread" | "pending"; source?: NotificationSource }) {
    if (input.filter === "pending" && input.source && input.source !== "terminal-attention") {
      return { items: [], nextCursor: null }
    }
    const cursor = input.cursor
      ? await this.prisma.userNotification.findFirst({ where: { id: input.cursor, userId }, select: { createdAt: true, id: true } })
      : null
    const rows = await this.prisma.userNotification.findMany({
      where: {
        userId,
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - retentionMs) },
        ...(input.source ? { source: input.source } : {}),
        ...(input.filter === "unread" ? { readAt: null } : {}),
        ...(input.filter === "pending" ? { source: "terminal-attention", resolvedAt: null } : {}),
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      include: { driveDiscussionTarget: { select: { kind: true, action: true, snapshot: true } } },
    })
    const items = await this.withMailSubjects(userId, rows.slice(0, 50).map(toNotificationProjection))
    return { items, nextCursor: rows.length > 50 ? rows[49]?.id ?? null : null }
  }

  async get(userId: string, id: string) {
    const record = await this.prisma.userNotification.findFirst({ where: { id, userId, deletedAt: null }, include: { driveDiscussionTarget: { select: { kind: true, action: true, snapshot: true } } } })
    if (!record) return null
    const [item] = await this.withMailSubjects(userId, [toNotificationProjection(record)])
    return item ?? null
  }

  private async withMailSubjects(userId: string, items: ReturnType<typeof toNotificationProjection>[]) {
    const messageIds = [...new Set(items.flatMap((item) => item.source === "mail-internal" && item.targetId ? [item.targetId] : []))]
    if (messageIds.length === 0) return items
    const messages = await this.prisma.mailMessage.findMany({
      where: { id: { in: messageIds }, OR: [{ senderId: userId, senderDeletedAt: null }, { recipients: { some: { userId, deletedAt: null } } }] },
      select: { id: true, subject: true }, take: messageIds.length,
    })
    const subjects = new Map(messages.map((message) => [message.id, message.subject]))
    return items.map((item) => {
      const mailSubject = item.source === "mail-internal" && item.targetId ? subjects.get(item.targetId) : undefined
      return mailSubject === undefined ? item : { ...item, mailSubject }
    })
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.userNotification.count({ where: { userId, readAt: null, deletedAt: null, createdAt: { gte: new Date(Date.now() - retentionMs) } } })
  }

  async markRead(userId: string, id: string, read = true): Promise<void> {
    await this.prisma.userNotification.updateMany({
      where: { id, userId, readAt: read ? null : { not: null }, deletedAt: null },
      data: { readAt: read ? new Date() : null },
    })
    this.publish(userId, id)
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.userNotification.updateMany({ where: { userId, readAt: null, deletedAt: null }, data: { readAt: new Date() } })
    this.publish(userId, "all")
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.prisma.userNotification.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } })
    this.publish(userId, id)
  }

  async deleteAll(userId: string, filter: "all" | "pending"): Promise<void> {
    await this.prisma.userNotification.updateMany({
      where: {
        userId,
        deletedAt: null,
        ...(filter === "pending" ? { source: "terminal-attention", resolvedAt: null } : {}),
      },
      data: { deletedAt: new Date() },
    })
    this.publish(userId, "all")
  }

  async resolveAttention(userId: string, deviceId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.userNotification.updateMany({
      where: { userId, source: "terminal-attention", deviceId, targetId: sessionId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    })
    if (result.count) this.publish(userId, "all")
  }

  /**
   * 这条会话结束了，它留下的那些「打开终端」就不再指向任何东西。
   *
   * 与 `resolveAttention` 是两件事，虽然两者都可能因为「这条会话不在了」被调用：
   *
   * - `resolveAttention` 说的是**待处理解除了**。会话还活着，只是不再等人回答，而那条通知
   *   留在原地照样打得到它的终端 —— 所以它只动 `resolvedAt`；
   * - 这一条说的是**这个句柄作废了**。会话没了，`targetId` 指的地方不存在了。所以要清掉它：
   *   手机那一边「打开终端」是按 `targetId` **有没有**来画的（`InboxView` 的详情页），清掉
   *   它，那个按下去只会得到「该终端已结束。」的按钮自己就消失了。只置 `resolvedAt` 不够 ——
   *   `terminal-complete` 根本不带那个语义，详情页也从不读它，按钮照样画得出来。
   *
   * 记录本身留着。它是一条「那一轮跑完了」的消息，这件事发生过；只是它附带的那次跳转已经
   * 无处可去 —— 按不动的按钮比没有按钮更糟。
   */
  async invalidateTerminalTarget(userId: string, deviceId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.userNotification.updateMany({
      where: {
        userId,
        deviceId,
        targetId: sessionId,
        source: { in: ["terminal-attention", "terminal-complete"] },
        deletedAt: null,
      },
      data: { targetId: null, resolvedAt: new Date() },
    })
    if (result.count) this.publish(userId, "all")
  }

  private publish(userId: string, notificationId: string): void {
    const event = createLiveEnvelope(LIVE_MESSAGE_TYPES.notificationChanged, { notificationId }, {
      id: randomUUID(), sentAt: new Date().toISOString(),
    })
    try {
      this.desktops.broadcastToUser(userId, event)
      this.mobiles.sendToMobileClients({ userId, message: event })
    } catch (error) {
      this.logger.warn({ reason: error instanceof Error ? error.name : typeof error }, "Notification change broadcast failed")
    }
  }

  @Cron("0 0 3 * * *")
  async pruneExpired(): Promise<void> {
    await this.prisma.userNotification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - retentionMs) } } })
  }
}

function toNotificationProjection(record: UserNotification & { driveDiscussionTarget?: { kind: string; action: string; snapshot?: unknown } | null }) {
  const { driveDiscussionTarget: target, ...notification } = record
  if (record.source !== "drive-discussion" || !target || !["annotation", "message"].includes(target.kind) || !["created", "replied"].includes(target.action)) return notification
  const snapshot = parseDriveDiscussionNotificationSnapshot(target.snapshot)
  return { ...notification, driveDiscussion: { kind: target.kind, action: target.action, ...(snapshot ? { snapshot } : {}) } as DriveDiscussionNotificationMetadata }
}
