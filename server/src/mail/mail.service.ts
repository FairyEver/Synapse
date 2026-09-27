import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { PrismaService } from "../prisma/prisma.service"
import { NotificationService } from "../notifications/notification.service"
import { MailStorageService } from "./mail-storage.service"
import { recipientMatch } from "./mail-recipient-match"

export const MAIL_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MAX_ATTACHMENTS = 10
const MAX_RECIPIENTS = 50
const PREVIEW_TTL_MS = 10 * 60 * 1000
const PENDING_ATTACHMENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

type Content = { recipientIds: string[]; subject: string; body: string; attachmentIds: string[]; replyToId?: string }

function ids(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((id) => typeof id !== "string" || !id)) throw new BadRequestException("无效的用户或附件列表。")
  return [...new Set(value as string[])]
}

function exposedUser(user: { id: string; nickname: string | null; handle: string | null }) {
  return { userId: user.id, nickname: user.nickname, handle: user.handle }
}

function safeFileName(input: string): string {
  const name = input.replace(/[\\/\u0000-\u001f\u007f]/gu, "_").trim()
  if (!name || name === "." || name === ".." || name.length > 255) throw new BadRequestException("无效的附件文件名。")
  return name
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MailStorageService,
    private readonly notifications: NotificationService,
  ) {}

  async searchRecipients(userId: string, query: string, cursor?: string) {
    const term = query.trim().toLocaleLowerCase()
    if (term.length > 100) throw new BadRequestException("收件人搜索词过长。")
    const memberships = await this.prisma.teamMembership.findMany({ where: { userId }, select: { teamId: true } })
    const teamIds = memberships.map((row) => row.teamId)
    if (!teamIds.length) return { items: [], nextCursor: null }
    const where = { id: { not: userId }, status: "active" as const, teamMemberships: { some: { teamId: { in: teamIds } } } }
    const select = { id: true, nickname: true, handle: true, teamMemberships: { where: { teamId: { in: teamIds } }, select: { teamId: true } } } as const
    if (!term) {
      if (cursor && !await this.prisma.user.findFirst({ where: { AND: [where, { id: cursor }] }, select: { id: true } })) throw new BadRequestException("无效的收件人分页位置。")
      const users = await this.prisma.user.findMany({
        where,
        select,
        orderBy: [{ nickname: "asc" }, { handle: "asc" }, { id: "asc" }],
        take: 51,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      const page = users.slice(0, 50)
      return { items: page.map((user) => ({ ...exposedUser(user), matchKind: "browse", similarity: 1, sharedTeamIds: user.teamMemberships.map((row) => row.teamId) })), nextCursor: users.length > 50 ? page.at(-1)?.id ?? null : null }
    }
    const users = await this.prisma.user.findMany({
      where,
      select,
    })
    const items = users.map((user) => {
      const match = recipientMatch(term, [user.id, user.nickname, user.handle])
      return match ? { ...exposedUser(user), ...match, sharedTeamIds: user.teamMemberships.map((row) => row.teamId) } : null
    }).filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => b.similarity - a.similarity || (a.nickname ?? a.handle ?? "").localeCompare(b.nickname ?? b.handle ?? ""))
    return { items: items.slice(0, 50), nextCursor: null }
  }

  async prepareLocalAttachment(userId: string, fileName: string, mimeType: string | null, body: Buffer) {
    if (body.length === 0) throw new BadRequestException("无效的附件。")
    if (body.length > MAIL_MAX_ATTACHMENT_BYTES) throw new PayloadTooLargeException("附件不能超过 20 MB。")
    return this.storeAttachment(userId, safeFileName(fileName), mimeType, body)
  }

  private async storeAttachment(userId: string, fileName: string, mimeType: string | null, body: Buffer) {
    const key = `mail/attachments/${randomUUID()}`
    await this.storage.put(key, body, mimeType)
    try {
      const row = await this.prisma.mailAttachment.create({ data: { ownerId: userId, fileName, mimeType, size: BigInt(body.length), storageKey: key } })
      return { attachmentId: row.id, attachmentToken: row.id, fileName: row.fileName, mimeType: row.mimeType, size: Number(row.size), state: "ready" as const }
    } catch (error) {
      await this.storage.delete(key).catch((cleanupError: unknown) => this.logger.error({ reason: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError }, "Mail object cleanup failed"))
      throw error
    }
  }

  async createPreview(userId: string, raw: Content) {
    const recipientIds = ids(raw.recipientIds, MAX_RECIPIENTS)
    const attachmentIds = ids(raw.attachmentIds, MAX_ATTACHMENTS)
    const subject = raw.subject?.trim()
    const body = raw.body?.trim()
    if (!recipientIds.length || !subject || subject.length > 120 || !body || body.length > 100_000 || recipientIds.includes(userId)) throw new BadRequestException("请填写收件人、主题和正文。")
    const participants = await this.prisma.user.findMany({
      where: { id: { in: [userId, ...recipientIds] }, status: "active" },
      select: { id: true, nickname: true, handle: true, teamMemberships: { select: { teamId: true } } },
    })
    if (participants.length !== recipientIds.length + 1) throw new ForbiddenException("收件人已失效。")
    const common = participants.reduce<string[]>((shared, user, index) => index === 0 ? user.teamMemberships.map((row) => row.teamId) : shared.filter((id) => user.teamMemberships.some((row) => row.teamId === id)), [])
    if (!common.length) throw new ForbiddenException("所有收件人必须与发件人在同一团队。")
    const team = await this.prisma.team.findFirst({ where: { id: { in: common } }, orderBy: { id: "asc" } })
    if (!team) throw new ForbiddenException("团队不存在。")
    const attachments = await this.prisma.mailAttachment.findMany({ where: { id: { in: attachmentIds }, ownerId: userId, messageId: null } })
    if (attachments.length !== attachmentIds.length) throw new ConflictException("附件已失效，请重新添加。")
    if (raw.replyToId) await this.getMessage(userId, raw.replyToId)
    const preview = await this.prisma.$transaction(async (tx) => {
      if (attachmentIds.length) {
        const reserved = await tx.mailAttachment.updateMany({ where: { id: { in: attachmentIds }, ownerId: userId, messageId: null }, data: { lastReferencedAt: new Date() } })
        if (reserved.count !== attachmentIds.length) throw new ConflictException("附件已失效，请重新添加。")
      }
      return tx.mailSendPreview.create({ data: { userId, recipientIds, attachmentIds, teamIdSnapshot: team.id, teamNameSnapshot: team.name, subject, body, replyToId: raw.replyToId, expiresAt: new Date(Date.now() + PREVIEW_TTL_MS) } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { previewId: preview.id, expiresAt: preview.expiresAt, team: { id: team.id, name: team.name }, recipients: recipientIds.map((id) => exposedUser(participants.find((user) => user.id === id)!)), subject, body, attachments: attachmentIds.map((id) => { const row = attachments.find((item) => item.id === id)!; return { attachmentId: id, fileName: row.fileName, size: Number(row.size) } }) }
  }

  async send(userId: string, previewId: string, clientRequestId: string) {
    if (!clientRequestId || clientRequestId.length > 100) throw new BadRequestException("无效的请求标识。")
    const previous = await this.prisma.mailMessage.findUnique({ where: { senderId_clientRequestId: { senderId: userId, clientRequestId } }, include: { recipients: true } })
    if (previous) {
      if (previous.previewId !== previewId) throw new ConflictException("请求标识已用于另一封信。")
      const result = { messageId: previous.id, recipientIds: previous.recipients.map((row) => row.userId), sentAt: previous.sentAt }
      await this.deliverPendingNotifications(previous.id)
      return result
    }
    const preview = await this.prisma.mailSendPreview.findFirst({ where: { id: previewId, userId, expiresAt: { gt: new Date() } } })
    if (!preview) throw new ConflictException("发送预览已过期，请重新确认。")
    const recipientIds = ids(preview.recipientIds, MAX_RECIPIENTS)
    const attachmentIds = ids(preview.attachmentIds, MAX_ATTACHMENTS)
    let result: { messageId: string; recipientIds: string[]; sentAt: Date } | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await this.prisma.$transaction(async (tx) => {
          const validUsers = await tx.user.count({ where: { id: { in: [userId, ...recipientIds] }, status: "active", teamMemberships: { some: { teamId: preview.teamIdSnapshot } } } })
          if (validUsers !== recipientIds.length + 1) throw new ForbiddenException("团队成员已变化，请重新确认。")
          if (await tx.mailAttachment.count({ where: { id: { in: attachmentIds }, ownerId: userId, messageId: null } }) !== attachmentIds.length) throw new ConflictException("附件已失效，请重新添加。")
          const message = await tx.mailMessage.create({ data: { senderId: userId, teamIdSnapshot: preview.teamIdSnapshot, teamNameSnapshot: preview.teamNameSnapshot, subject: preview.subject, body: preview.body, replyToId: preview.replyToId, clientRequestId, previewId, recipients: { create: recipientIds.map((id) => ({ userId: id })) } } })
          if (attachmentIds.length) {
            const claimed = await tx.mailAttachment.updateMany({ where: { id: { in: attachmentIds }, ownerId: userId, messageId: null }, data: { messageId: message.id } })
            if (claimed.count !== attachmentIds.length) throw new ConflictException("附件已被使用，请重新添加。")
          }
          await tx.mailNotificationOutbox.createMany({ data: recipientIds.map((recipientId) => ({ messageId: message.id, recipientId })) })
          return { messageId: message.id, recipientIds, sentAt: message.sentAt }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
        break
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await this.prisma.mailMessage.findFirst({ where: { OR: [{ senderId: userId, clientRequestId }, { previewId }] }, include: { recipients: true } })
          if (existing?.senderId === userId && existing.previewId === previewId && existing.clientRequestId === clientRequestId) {
            result = { messageId: existing.id, recipientIds: existing.recipients.map((row) => row.userId), sentAt: existing.sentAt }
            break
          }
          throw new ConflictException("发送预览或请求标识已被使用，请重新确认。")
        }
        throw error
      }
    }
    if (!result) throw new ConflictException("发送遇到并发冲突，请重试。")
    await this.deliverPendingNotifications(result.messageId)
    return result
  }

  @Cron("*/5 * * * *")
  async retryPendingNotifications(): Promise<void> {
    try { await this.deliverPendingNotifications() }
    catch (error) { this.logger.warn({ reason: error instanceof Error ? error.name : typeof error }, "Mail notification retry failed") }
  }

  private async deliverPendingNotifications(messageId?: string): Promise<void> {
    let cursor: { createdAt: Date; id: string } | undefined
    do {
      const pending = await this.prisma.mailNotificationOutbox.findMany({
        where: {
          ...(messageId ? { messageId } : {}),
          ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
        },
        include: { message: { select: { sender: { select: { nickname: true, handle: true } } } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
      })
      for (const item of pending) {
        try {
          const senderName = item.message.sender.nickname || item.message.sender.handle || "团队成员"
          await this.notifications.create({ userId: item.recipientId, source: "mail", sourceKey: `mail:${item.messageId}`, title: "新站内信", body: `来自 ${senderName}。`, group: "mail", targetId: item.messageId, url: `synapse://mail/${item.messageId}` })
          await this.prisma.mailNotificationOutbox.deleteMany({ where: { id: item.id } })
        } catch (error) {
          this.logger.warn({ recipientId: item.recipientId, messageId: item.messageId, reason: error instanceof Error ? error.name : typeof error }, "Mail notification failed")
        }
      }
      if (pending.length < 100) break
      cursor = { createdAt: pending.at(-1)!.createdAt, id: pending.at(-1)!.id }
    } while (true)
  }

  async listMessages(userId: string, box: "inbox" | "sent", query = "", cursor?: string) {
    const search = query.trim()
    if (search.length > 120) throw new BadRequestException("搜索词过长。")
    const cursorRow = cursor ? await this.prisma.mailMessage.findFirst({ where: { id: cursor, ...(box === "sent" ? { senderId: userId, senderDeletedAt: null } : { recipients: { some: { userId, deletedAt: null } } }) }, select: { id: true, sentAt: true } }) : null
    if (cursor && !cursorRow) throw new BadRequestException("无效的分页位置。")
    const rows = await this.prisma.mailMessage.findMany({
      where: {
        ...(box === "sent" ? { senderId: userId, senderDeletedAt: null } : { recipients: { some: { userId, deletedAt: null } } }),
        ...(search ? { OR: [{ subject: { contains: search, mode: "insensitive" } }, { body: { contains: search, mode: "insensitive" } }] } : {}),
        ...(cursorRow ? { AND: [{ OR: [{ sentAt: { lt: cursorRow.sentAt } }, { sentAt: cursorRow.sentAt, id: { lt: cursorRow.id } }] }] } : {}),
      },
      include: { sender: { select: { id: true, nickname: true, handle: true } }, recipients: { include: { user: { select: { id: true, nickname: true, handle: true } } } }, attachments: { select: { id: true } } },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }], take: 51,
    })
    return { items: rows.slice(0, 50).map((row) => this.summary(row, userId)), nextCursor: rows.length > 50 ? rows[49]!.id : null }
  }

  async getMessage(userId: string, id: string) {
    const row = await this.prisma.mailMessage.findFirst({
      where: { id, OR: [{ senderId: userId, senderDeletedAt: null }, { recipients: { some: { userId, deletedAt: null } } }] },
      include: { sender: { select: { id: true, nickname: true, handle: true } }, recipients: { include: { user: { select: { id: true, nickname: true, handle: true } } } }, attachments: true },
    })
    if (!row) throw new NotFoundException("信件不存在。")
    return { ...this.summary(row, userId), viewerId: userId, body: row.body, team: { id: row.teamIdSnapshot, name: row.teamNameSnapshot }, replyToId: row.replyToId, attachments: row.attachments.map((item) => ({ attachmentId: item.id, fileName: item.fileName, mimeType: item.mimeType, size: Number(item.size) })) }
  }

  private summary(row: { id: string; senderId: string; sender: { id: string; nickname: string | null; handle: string | null }; recipients: { userId: string; readAt: Date | null; user: { id: string; nickname: string | null; handle: string | null } }[]; subject: string; body: string; sentAt: Date; attachments: { id: string }[] }, userId: string) {
    return { messageId: row.id, sender: exposedUser(row.sender), recipients: row.recipients.map((item) => exposedUser(item.user)), subject: row.subject, snippet: row.body.slice(0, 160), sentAt: row.sentAt, readAt: row.senderId === userId ? row.sentAt : row.recipients.find((item) => item.userId === userId)?.readAt ?? null, attachmentCount: row.attachments.length }
  }

  async setRead(userId: string, id: string, read: boolean) {
    const result = await this.prisma.mailRecipient.updateMany({ where: { messageId: id, userId, deletedAt: null }, data: { readAt: read ? new Date() : null } })
    if (!result.count) throw new NotFoundException("信件不存在。")
    return { read }
  }

  async deleteMessage(userId: string, id: string) {
    const [recipient, sender] = await this.prisma.$transaction([
      this.prisma.mailRecipient.updateMany({ where: { messageId: id, userId, deletedAt: null }, data: { deletedAt: new Date() } }),
      this.prisma.mailMessage.updateMany({ where: { id, senderId: userId, senderDeletedAt: null }, data: { senderDeletedAt: new Date() } }),
    ])
    if (!recipient.count && !sender.count) throw new NotFoundException("信件不存在。")
    return { deleted: true }
  }

  async downloadAttachment(userId: string, messageId: string, attachmentId: string) {
    await this.getMessage(userId, messageId)
    const row = await this.prisma.mailAttachment.findFirst({ where: { id: attachmentId, messageId } })
    if (!row) throw new NotFoundException("附件不存在。")
    return { stream: await this.storage.open(row.storageKey), fileName: row.fileName, mimeType: row.mimeType, size: Number(row.size) }
  }

  @Cron("0 * * * *")
  async scheduledCleanup(): Promise<void> {
    try { await this.cleanupExpiredMail() }
    catch (error) { this.logger.warn({ reason: error instanceof Error ? error.name : typeof error }, "Mail cleanup failed") }
  }

  async cleanupExpiredMail(now = new Date()): Promise<void> {
    await this.prisma.mailSendPreview.deleteMany({ where: { expiresAt: { lt: now } } })
    const cutoff = new Date(now.getTime() - PENDING_ATTACHMENT_RETENTION_MS)
    let cursor: { lastReferencedAt: Date; id: string } | undefined
    do {
      const candidates = await this.prisma.mailAttachment.findMany({
        where: {
          messageId: null,
          lastReferencedAt: { lt: cutoff },
          ...(cursor ? { OR: [{ lastReferencedAt: { gt: cursor.lastReferencedAt } }, { lastReferencedAt: cursor.lastReferencedAt, id: { gt: cursor.id } }] } : {}),
        },
        select: { id: true, ownerId: true, storageKey: true, lastReferencedAt: true },
        orderBy: [{ lastReferencedAt: "asc" }, { id: "asc" }],
        take: 100,
      })
      const ownerIds = [...new Set(candidates.map((item) => item.ownerId))]
      if (ownerIds.length) {
        const previews = await this.prisma.mailSendPreview.findMany({ where: { userId: { in: ownerIds }, expiresAt: { gt: now } }, select: { attachmentIds: true } })
        const referenced = new Set(previews.flatMap((row) => Array.isArray(row.attachmentIds) ? row.attachmentIds.filter((id): id is string => typeof id === "string") : []))
        for (const item of candidates) {
          if (referenced.has(item.id)) continue
          try {
            await this.prisma.$transaction(async (tx) => {
              const deleted = await tx.mailAttachment.deleteMany({ where: { id: item.id, messageId: null, lastReferencedAt: { lt: cutoff } } })
              if (deleted.count) await tx.mailStorageDeletion.create({ data: { storageKey: item.storageKey } })
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
          } catch (error) {
            this.logger.warn({ attachmentId: item.id, reason: error instanceof Error ? error.name : typeof error }, "Mail attachment cleanup failed")
          }
        }
      }
      if (candidates.length < 100) break
      cursor = { lastReferencedAt: candidates.at(-1)!.lastReferencedAt, id: candidates.at(-1)!.id }
    } while (true)
    let deletionCursor: { createdAt: Date; id: string } | undefined
    do {
      const deletions = await this.prisma.mailStorageDeletion.findMany({
        where: deletionCursor ? { OR: [{ createdAt: { gt: deletionCursor.createdAt } }, { createdAt: deletionCursor.createdAt, id: { gt: deletionCursor.id } }] } : undefined,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
      })
      for (const item of deletions) {
        try {
          await this.storage.delete(item.storageKey)
          await this.prisma.mailStorageDeletion.deleteMany({ where: { id: item.id } })
        } catch (error) {
          this.logger.warn({ deletionId: item.id, reason: error instanceof Error ? error.name : typeof error }, "Mail storage deletion failed")
        }
      }
      if (deletions.length < 100) break
      deletionCursor = { createdAt: deletions.at(-1)!.createdAt, id: deletions.at(-1)!.id }
    } while (true)
  }
}
