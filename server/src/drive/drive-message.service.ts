import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { DRIVE_MESSAGE_BODY_MAX_LENGTH, isDriveCommentableMarkdownItem, type DriveMessageCommentDto, type DriveMessageDto, type DriveMessageListDto } from "@synapse/shared"
import { formatAuditError } from "../common/audit-error"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import { DRIVE_ITEM_LIFECYCLE_STATUS, DRIVE_STORAGE_STATUS } from "./drive.constants"
import { DriveService } from "./drive.service"
import { LocalDriveCollaborationBus } from "./drive-collaboration-bus"

export type DriveMessageAccess =
  | { readonly kind: "owned"; readonly itemId: string }
  | { readonly kind: "share"; readonly shareId: string; readonly itemId?: string | null; readonly password?: string; readonly cookie?: string | null }

type MessageItem = { readonly id: string; readonly userId: string; readonly name: string; readonly type: string; readonly mimeType: string | null }
type MessageActor = { readonly id: string; readonly email: string; readonly handle: string | null }
type MessageCommentRecord = {
  readonly id: string; readonly messageId: string; readonly parentCommentId: string | null; readonly body: string
  readonly createdByUserId: string; readonly createdByUser: MessageActor
  readonly createdAt: Date; readonly updatedAt: Date; readonly editedAt: Date | null; readonly deletedAt: Date | null
}
type MessageRecord = {
  readonly id: string; readonly itemId: string; readonly body: string
  readonly createdByUserId: string; readonly createdByUser: MessageActor
  readonly createdAt: Date; readonly updatedAt: Date; readonly editedAt: Date | null; readonly deletedAt: Date | null
  readonly comments: readonly MessageCommentRecord[]
}

const messageInclude = {
  createdByUser: { select: { id: true, email: true, handle: true } },
  comments: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: { createdByUser: { select: { id: true, email: true, handle: true } } },
  },
}

export function parseDriveMessageBody(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("留言内容无效。")
  const body = value.trim()
  if (!body || body.length > DRIVE_MESSAGE_BODY_MAX_LENGTH) throw new BadRequestException("留言内容须为 1–4000 字符。")
  return body
}

@Injectable()
export class DriveMessageService {
  private readonly logger = new Logger(DriveMessageService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly collaborationBus?: LocalDriveCollaborationBus,
  ) {}

  async list(access: DriveMessageAccess, actorUserId: string | null): Promise<DriveMessageListDto> {
    const item = await this.resolveItem(access, actorUserId)
    const messages = await this.prisma.driveMessage.findMany({
      where: { itemId: item.id, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: messageInclude,
    })
    return {
      itemId: item.id,
      canPost: Boolean(actorUserId),
      messages: messages.map((message) => toMessageDto(message, actorUserId, item.userId, access.kind === "share")),
    }
  }

  async create(
    access: DriveMessageAccess,
    actorUserId: string,
    body: string,
    ipAddress?: string,
    idempotency?: { readonly keyHash: string; readonly requestHash: string },
  ): Promise<DriveMessageDto> {
    const item = await this.resolveItem(access, actorUserId)
    const content = parseDriveMessageBody(body)
    if (idempotency) {
      const previous = await this.prisma.driveMessage.findUnique({
        where: { openApiIdempotencyHash: idempotency.keyHash }, include: messageInclude,
      })
      if (previous) return this.replayedMessage(previous, idempotency.requestHash, actorUserId, item.userId)
    }
    let message: MessageRecord
    try {
      message = await this.prisma.driveMessage.create({
        data: {
          itemId: item.id, body: content, createdByUserId: actorUserId,
          ...(idempotency ? {
            openApiIdempotencyHash: idempotency.keyHash,
            openApiRequestHash: idempotency.requestHash,
          } : {}),
        },
        include: messageInclude,
      })
    } catch (error) {
      if (idempotency && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const previous = await this.prisma.driveMessage.findUnique({
          where: { openApiIdempotencyHash: idempotency.keyHash }, include: messageInclude,
        })
        if (previous) return this.replayedMessage(previous, idempotency.requestHash, actorUserId, item.userId)
      }
      throw error
    }
    await this.afterMutation(item.id, actorUserId, "drive.message.create", "drive.message", message.id, ipAddress)
    return toMessageDto(message, actorUserId, item.userId, access.kind === "share")
  }

  private replayedMessage(message: MessageRecord & { readonly openApiRequestHash: string | null }, requestHash: string, actorUserId: string, ownerId: string): DriveMessageDto {
    if (message.openApiRequestHash !== requestHash) throw new ConflictException("去重键对应不同请求。")
    return toMessageDto(message, actorUserId, ownerId, true)
  }

  async update(access: DriveMessageAccess, actorUserId: string, messageId: string, body: string, ipAddress?: string): Promise<DriveMessageDto> {
    const item = await this.resolveItem(access, actorUserId)
    const message = await this.requireMessage(item.id, messageId)
    if (message.createdByUserId !== actorUserId) throw new ForbiddenException("不能编辑他人的留言。")
    const updated = await this.prisma.driveMessage.update({
      where: { id: messageId }, data: { body: parseDriveMessageBody(body), editedAt: new Date() }, include: messageInclude,
    })
    await this.afterMutation(item.id, actorUserId, "drive.message.update", "drive.message", messageId, ipAddress)
    return toMessageDto(updated, actorUserId, item.userId, access.kind === "share")
  }

  async delete(access: DriveMessageAccess, actorUserId: string, messageId: string, ipAddress?: string): Promise<{ readonly ok: true }> {
    const item = await this.resolveItem(access, actorUserId)
    const message = await this.requireMessage(item.id, messageId)
    assertCanDelete(message.createdByUserId, actorUserId, item.userId)
    const deletedAt = new Date()
    await this.prisma.$transaction([
      this.prisma.driveMessageComment.updateMany({ where: { messageId, deletedAt: null }, data: { deletedAt } }),
      this.prisma.driveMessage.update({ where: { id: messageId }, data: { deletedAt } }),
    ])
    await this.afterMutation(item.id, actorUserId, "drive.message.delete", "drive.message", messageId, ipAddress)
    return { ok: true }
  }

  async createComment(access: DriveMessageAccess, actorUserId: string, messageId: string, parentCommentId: string | null, body: string, ipAddress?: string): Promise<DriveMessageCommentDto> {
    const item = await this.resolveItem(access, actorUserId)
    await this.requireMessage(item.id, messageId)
    if (parentCommentId) {
      const parent = await this.prisma.driveMessageComment.findFirst({ where: { id: parentCommentId, messageId, deletedAt: null } })
      if (!parent) throw new BadRequestException("回复目标不存在。")
    }
    const comment = await this.prisma.driveMessageComment.create({
      data: { messageId, parentCommentId, body: parseDriveMessageBody(body), createdByUserId: actorUserId },
      include: { createdByUser: { select: { id: true, email: true, handle: true } } },
    })
    await this.afterMutation(item.id, actorUserId, "drive.message.comment.create", "drive.messageComment", comment.id, ipAddress)
    return toCommentDto(comment, actorUserId, item.userId, access.kind === "share")
  }

  async updateComment(access: DriveMessageAccess, actorUserId: string, commentId: string, body: string, ipAddress?: string): Promise<DriveMessageCommentDto> {
    const item = await this.resolveItem(access, actorUserId)
    const comment = await this.requireComment(item.id, commentId)
    if (comment.createdByUserId !== actorUserId) throw new ForbiddenException("不能编辑他人的回复。")
    const updated = await this.prisma.driveMessageComment.update({
      where: { id: commentId }, data: { body: parseDriveMessageBody(body), editedAt: new Date() },
      include: { createdByUser: { select: { id: true, email: true, handle: true } } },
    })
    await this.afterMutation(item.id, actorUserId, "drive.message.comment.update", "drive.messageComment", commentId, ipAddress)
    return toCommentDto(updated, actorUserId, item.userId, access.kind === "share")
  }

  async deleteComment(access: DriveMessageAccess, actorUserId: string, commentId: string, ipAddress?: string): Promise<{ readonly ok: true }> {
    const item = await this.resolveItem(access, actorUserId)
    const comment = await this.requireComment(item.id, commentId)
    assertCanDelete(comment.createdByUserId, actorUserId, item.userId)
    const comments = await this.prisma.driveMessageComment.findMany({
      where: { messageId: comment.messageId, deletedAt: null }, select: { id: true, parentCommentId: true },
    })
    const children = new Map<string, string[]>()
    for (const row of comments) {
      if (!row.parentCommentId) continue
      children.set(row.parentCommentId, [...(children.get(row.parentCommentId) ?? []), row.id])
    }
    const ids = new Set<string>()
    const pending = [commentId]
    while (pending.length) {
      const id = pending.pop()!
      if (ids.has(id)) continue
      ids.add(id)
      pending.push(...(children.get(id) ?? []))
    }
    await this.prisma.$transaction([
      this.prisma.driveMessageComment.updateMany({ where: { id: { in: [...ids] }, deletedAt: null }, data: { deletedAt: new Date() } }),
    ])
    await this.afterMutation(item.id, actorUserId, "drive.message.comment.delete", "drive.messageComment", commentId, ipAddress)
    return { ok: true }
  }

  private async resolveItem(access: DriveMessageAccess, actorUserId: string | null): Promise<MessageItem> {
    let item: MessageItem | null
    if (access.kind === "owned") {
      if (!actorUserId) throw new ForbiddenException("请先登录。")
      item = await this.prisma.driveItem.findFirst({
        where: { id: access.itemId, userId: actorUserId, storageStatus: DRIVE_STORAGE_STATUS.active, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active, deletedAt: null },
        select: { id: true, userId: true, name: true, type: true, mimeType: true },
      })
    } else {
      const result = await this.drive.resolveShareAnnotationAccess({
        shareId: access.shareId, itemId: access.itemId, cookie: access.cookie ?? undefined, password: access.password, actorUserId,
      })
      item = result.item
    }
    if (!item) throw new NotFoundException("文档不存在。")
    if (!isDriveCommentableMarkdownItem(item)) throw new BadRequestException("留言仅支持 Markdown 文档。")
    return item
  }

  private async requireMessage(itemId: string, messageId: string) {
    const message = await this.prisma.driveMessage.findFirst({ where: { id: messageId, itemId, deletedAt: null }, include: messageInclude })
    if (!message) throw new NotFoundException("留言不存在。")
    return message
  }

  private async requireComment(itemId: string, commentId: string) {
    const comment = await this.prisma.driveMessageComment.findFirst({
      where: { id: commentId, deletedAt: null, message: { itemId, deletedAt: null } },
      include: { createdByUser: { select: { id: true, email: true, handle: true } } },
    })
    if (!comment) throw new NotFoundException("回复不存在。")
    return comment
  }

  private async afterMutation(itemId: string, actorUserId: string, action: string, targetType: string, targetId: string, ipAddress?: string) {
    this.collaborationBus?.publish(itemId, { type: "message.changed", itemId })
    if (!this.auditLog) return
    try {
      const actor = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { email: true } })
      await this.auditLog.record({
        adminEmail: actor?.email ?? actorUserId, action, targetType, targetId,
        detail: { actorUserId, itemId }, ipAddress: ipAddress ?? "system",
      })
    } catch (error) {
      this.logger.warn({ action, errorName: error instanceof Error ? error.name : typeof error, errorMessage: formatAuditError(error) }, "Drive message audit log write failed")
    }
  }
}

function assertCanDelete(authorId: string, actorId: string, ownerId: string) {
  if (actorId !== authorId && actorId !== ownerId) throw new ForbiddenException("不能删除该留言或回复。")
}

function toMessageDto(record: MessageRecord, actorId: string | null, ownerId: string, redactEmail: boolean): DriveMessageDto {
  return {
    id: record.id, itemId: record.itemId, body: record.body,
    author: toAuthor(record.createdByUser, redactEmail),
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), editedAt: record.editedAt?.toISOString() ?? null,
    comments: record.comments.map((comment) => toCommentDto(comment, actorId, ownerId, redactEmail)),
    permissions: { canEdit: actorId === record.createdByUserId, canDelete: Boolean(actorId && (actorId === record.createdByUserId || actorId === ownerId)) },
  }
}

function toCommentDto(record: MessageCommentRecord, actorId: string | null, ownerId: string, redactEmail: boolean): DriveMessageCommentDto {
  return {
    id: record.id, messageId: record.messageId, parentCommentId: record.parentCommentId, body: record.body,
    author: toAuthor(record.createdByUser, redactEmail),
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), editedAt: record.editedAt?.toISOString() ?? null,
    permissions: { canEdit: actorId === record.createdByUserId, canDelete: Boolean(actorId && (actorId === record.createdByUserId || actorId === ownerId)) },
  }
}

function toAuthor(actor: MessageActor, redactEmail: boolean) {
  return { id: actor.id, email: redactEmail ? null : actor.email, handle: actor.handle }
}
