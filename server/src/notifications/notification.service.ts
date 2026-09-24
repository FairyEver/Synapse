import { randomUUID } from "node:crypto"
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma, type UserNotification } from "@prisma/client"
import { LIVE_MESSAGE_TYPES, createLiveEnvelope } from "@synapse/shared"
import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { MobileLiveGateway } from "../mobile-live/mobile-live.gateway"
import { MobilePushService } from "../mobile-live/mobile-push.service"
import { MobileLiveRelayService } from "../mobile-live/mobile-live-relay.service"
import { PrismaService } from "../prisma/prisma.service"

export type NotificationLevel = "active" | "passive" | "timeSensitive"
export type NotificationSource = "external" | "system-notifier" | "terminal-attention" | "terminal-complete" | "meeting-transcription"

export type CreateNotificationInput = {
  userId: string
  source: NotificationSource
  sourceKey?: string
  title: string
  body: string
  group?: string
  url?: string
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
        })
      void delivery.catch((error: unknown) => {
        this.logger.warn({ reason: error instanceof Error ? error.name : typeof error }, "Notification APNs delivery failed")
      })
    }
    return record
  }

  async list(userId: string, input: { cursor?: string; filter?: "all" | "unread" | "pending" }) {
    const cursor = input.cursor
      ? await this.prisma.userNotification.findFirst({ where: { id: input.cursor, userId }, select: { createdAt: true, id: true } })
      : null
    const rows = await this.prisma.userNotification.findMany({
      where: {
        userId,
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - retentionMs) },
        ...(input.filter === "unread" ? { readAt: null } : {}),
        ...(input.filter === "pending" ? { source: "terminal-attention", resolvedAt: null } : {}),
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
    })
    return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]?.id ?? null : null }
  }

  async get(userId: string, id: string) {
    return this.prisma.userNotification.findFirst({ where: { id, userId, deletedAt: null } })
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.userNotification.count({ where: { userId, readAt: null, deletedAt: null, createdAt: { gte: new Date(Date.now() - retentionMs) } } })
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.userNotification.updateMany({ where: { id, userId, readAt: null, deletedAt: null }, data: { readAt: new Date() } })
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
