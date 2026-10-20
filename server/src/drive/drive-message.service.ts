import { DriveDiscussionNotificationService } from "./drive-discussion-notification.service"
import { makeDriveDiscussionEvent } from "./drive-discussion-notification.types"
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { DRIVE_MESSAGE_BODY_MAX_LENGTH, isDriveCommentableMarkdownItem, type DriveMessageCommentDto, type DriveMessageDto, type DriveMessageListDto } from "@synapse/shared"
import { formatAuditError } from "../common/audit-error"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import { DRIVE_ITEM_LIFECYCLE_STATUS, DRIVE_STORAGE_STATUS } from "./drive.constants"
import { DriveService } from "./drive.service"
import { LocalDriveCollaborationBus } from "./drive-collaboration-bus"
import { DriveDocumentHostedImageService } from "./drive-document-hosted-image.service"
import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"

export type DriveMessageAccess =
  | { readonly kind: "owned"; readonly itemId: string }
  | { readonly kind: "share"; readonly shareId: string; readonly itemId?: string | null; readonly password?: string; readonly cookie?: string | null }

type MessageItem = { readonly sourceShareId?: string | null; readonly id: string; readonly userId: string; readonly name: string; readonly type: string; readonly mimeType: string | null }
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
    private readonly discussion: DriveDiscussionNotificationService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly collaborationBus?: LocalDriveCollaborationBus,
    @Optional() private readonly hostedImages?: DriveDocumentHostedImageService,
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
      messages: await Promise.all(messages.map((message) => toMessageDto(message, actorUserId, item.userId, access.kind === "share"))),
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
      message = await this.discussion.mutate(item.id, async (tx) => {
      await this.drive.validateDiscussionWriteAccess(tx, access.kind === "owned"
        ? { kind: "owned", itemId: item.id, actorUserId }
        : { kind: "share", itemId: item.id, actorUserId, shareId: access.shareId, sourceShareId: item.sourceShareId ?? null, password: access.password, cookie: access.cookie })
        const message = await tx.driveMessage.create({
          data: {
            itemId: item.id, body: content, createdByUserId: actorUserId, sourceShareId: item.sourceShareId ?? null,
            ...(idempotency ? {
              openApiIdempotencyHash: idempotency.keyHash,
              openApiRequestHash: idempotency.requestHash,
            } : {}),
          },
          include: messageInclude,
        })
        await this.hostedImages?.activateReferencedImages(tx, { sourceItemId: item.id, markdown: content })
        return { result: message, event: makeDriveDiscussionEvent("message", "created", item, message, null, content) }
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

  private replayedMessage(message: MessageRecord & { readonly openApiRequestHash: string | null }, requestHash: string, actorUserId: string, ownerId: string): Promise<DriveMessageDto> {
    if (message.openApiRequestHash !== requestHash) throw new ConflictException("去重键对应不同请求。")
    return toMessageDto(message, actorUserId, ownerId, true)
  }

  async update(access: DriveMessageAccess, actorUserId: string, messageId: string, body: string, ipAddress?: string): Promise<DriveMessageDto> {
    const item = await this.resolveItem(access, actorUserId)
    const content = parseDriveMessageBody(body)
    const updated = await this.discussion.withItemLock(item.id, async (tx) => {
      await this.validateWriteAccess(tx, access, item, actorUserId)
      const message = await tx.driveMessage.findFirst({ where: { id: messageId, itemId: item.id, deletedAt: null }, include: messageInclude })
      if (!message) throw new NotFoundException("留言不存在。")
      if (message.createdByUserId !== actorUserId) throw new ForbiddenException("不能编辑他人的留言。")
      const updated = await tx.driveMessage.update({
        where: { id: messageId }, data: { body: content, editedAt: new Date() }, include: messageInclude,
      })
      await this.hostedImages?.activateReferencedImages(tx, { sourceItemId: item.id, markdown: content })
      return updated
    })
    await this.afterMutation(item.id, actorUserId, "drive.message.update", "drive.message", messageId, ipAddress)
    return toMessageDto(updated, actorUserId, item.userId, access.kind === "share")
  }

  async delete(access: DriveMessageAccess, actorUserId: string, messageId: string, ipAddress?: string): Promise<{ readonly ok: true }> {
    const item = await this.resolveItem(access, actorUserId)
    await this.discussion.withItemLock(item.id, async (tx) => {
      const message = await tx.driveMessage.findFirst({ where: { id: messageId, itemId: item.id, deletedAt: null }, include: messageInclude })
      if (!message) throw new NotFoundException("留言不存在。")
      assertCanDelete(message.createdByUserId, actorUserId, item.userId)
      const deletedAt = new Date()
      await tx.driveMessageComment.updateMany({ where: { messageId, deletedAt: null }, data: { deletedAt } })
      await tx.driveMessage.update({ where: { id: messageId }, data: { deletedAt } })
    })
    await this.afterMutation(item.id, actorUserId, "drive.message.delete", "drive.message", messageId, ipAddress)
    return { ok: true }
  }

  async createComment(access: DriveMessageAccess, actorUserId: string, messageId: string, parentCommentId: string | null, body: string, ipAddress?: string): Promise<DriveMessageCommentDto> {
    const item = await this.resolveItem(access, actorUserId)
    const comment = await this.discussion.mutate(item.id, async (tx) => {
      await this.drive.validateDiscussionWriteAccess(tx, access.kind === "owned"
        ? { kind: "owned", itemId: item.id, actorUserId }
        : { kind: "share", itemId: item.id, actorUserId, shareId: access.shareId, sourceShareId: item.sourceShareId ?? null, password: access.password, cookie: access.cookie })
      const message = await tx.driveMessage.findFirst({ where: { id: messageId, itemId: item.id, deletedAt: null }, include: messageInclude })
      if (!message) throw new NotFoundException("留言不存在。")
      const parent = parentCommentId ? await tx.driveMessageComment.findFirst({ where: { id: parentCommentId, messageId, deletedAt: null }, include: { createdByUser: { select: { handle: true } } } }) : null
      if (parentCommentId && !parent) throw new BadRequestException("回复目标不存在。")
      const comment = await tx.driveMessageComment.create({
        data: { messageId, parentCommentId, body: parseDriveMessageBody(body), createdByUserId: actorUserId, sourceShareId: item.sourceShareId ?? null },
        include: { createdByUser: { select: { id: true, email: true, handle: true } } },
      })
      await this.hostedImages?.activateReferencedImages(tx, { sourceItemId: item.id, markdown: comment.body })
      return { result: comment, event: makeDriveDiscussionEvent("message", "replied", item, message, comment, comment.body, parent) }
    })
    await this.afterMutation(item.id, actorUserId, "drive.message.comment.create", "drive.messageComment", comment.id, ipAddress)
    return toCommentDto(comment, actorUserId, item.userId, access.kind === "share")
  }

  async updateComment(access: DriveMessageAccess, actorUserId: string, commentId: string, body: string, ipAddress?: string): Promise<DriveMessageCommentDto> {
    const item = await this.resolveItem(access, actorUserId)
    const content = parseDriveMessageBody(body)
    const updated = await this.discussion.withItemLock(item.id, async (tx) => {
      await this.validateWriteAccess(tx, access, item, actorUserId)
      const comment = await tx.driveMessageComment.findFirst({
        where: { id: commentId, deletedAt: null, message: { itemId: item.id, deletedAt: null } },
      })
      if (!comment) throw new NotFoundException("回复不存在。")
      if (comment.createdByUserId !== actorUserId) throw new ForbiddenException("不能编辑他人的回复。")
      const updated = await tx.driveMessageComment.update({
        where: { id: commentId }, data: { body: content, editedAt: new Date() },
        include: { createdByUser: { select: { id: true, email: true, handle: true } } },
      })
      await this.hostedImages?.activateReferencedImages(tx, { sourceItemId: item.id, markdown: content })
      return updated
    })
    await this.afterMutation(item.id, actorUserId, "drive.message.comment.update", "drive.messageComment", commentId, ipAddress)
    return toCommentDto(updated, actorUserId, item.userId, access.kind === "share")
  }

  async deleteComment(access: DriveMessageAccess, actorUserId: string, commentId: string, ipAddress?: string): Promise<{ readonly ok: true }> {
    const item = await this.resolveItem(access, actorUserId)
    await this.discussion.withItemLock(item.id, async (tx) => {
      const comment = await tx.driveMessageComment.findFirst({ where: { id: commentId, deletedAt: null, message: { itemId: item.id, deletedAt: null } }, include: { createdByUser: { select: { id: true, email: true, handle: true } } } })
      if (!comment) throw new NotFoundException("回复不存在。")
      assertCanDelete(comment.createdByUserId, actorUserId, item.userId)
      const comments = await tx.driveMessageComment.findMany({
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
      await tx.driveMessageComment.updateMany({ where: { id: { in: [...ids] }, deletedAt: null }, data: { deletedAt: new Date() } })
    })
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
      item = { ...result.item, sourceShareId: result.sourceShareId }
    }
    if (!item) throw new NotFoundException("文档不存在。")
    if (!isDriveCommentableMarkdownItem(item)) throw new BadRequestException("留言仅支持 Markdown 文档。")
    return item
  }

  private validateWriteAccess(tx: Prisma.TransactionClient, access: DriveMessageAccess, item: MessageItem, actorUserId: string) {
    return this.drive.validateDiscussionWriteAccess(tx, access.kind === "owned"
      ? { kind: "owned", itemId: item.id, actorUserId }
      : { kind: "share", itemId: item.id, actorUserId, shareId: access.shareId, sourceShareId: item.sourceShareId ?? null, password: access.password, cookie: access.cookie })
  }

  private async imageUploadItem(access: DriveMessageAccess, actorUserId: string) {
    if (!actorUserId) throw new ForbiddenException("请先登录。")
    const item = await this.resolveItem(access, actorUserId)
    await this.discussion.withItemLock(item.id, (tx) => this.validateWriteAccess(tx, access, item, actorUserId))
    return item
  }

  async prepareImageUpload(access: DriveMessageAccess, actorUserId: string, input: { readonly name: string; readonly size: string; readonly mimeType: string }) {
    const item = await this.imageUploadItem(access, actorUserId)
    return this.requireImages().prepareUpload({ actorUserId, sourceItemId: item.id, ...input })
  }

  async completeImageUpload(access: DriveMessageAccess, actorUserId: string, sessionId: string) {
    const item = await this.imageUploadItem(access, actorUserId)
    return this.requireImages().completeUpload({ actorUserId, sourceItemId: item.id, sessionId })
  }

  async cancelImageUpload(access: DriveMessageAccess, actorUserId: string, sessionId: string) {
    const item = await this.imageUploadItem(access, actorUserId)
    return this.requireImages().cancelUpload({ actorUserId, sourceItemId: item.id, sessionId })
  }

  private requireImages() {
    if (!this.hostedImages) throw new Error("文档图片服务不可用。")
    return this.hostedImages
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

async function toMessageDto(record: MessageRecord, actorId: string | null, ownerId: string, redactEmail: boolean): Promise<DriveMessageDto> {
  return {
    id: record.id, itemId: record.itemId, body: record.body,
    bodyHtml: (await renderDriveMarkdownFragment(record.body)).html,
    author: toAuthor(record.createdByUser, redactEmail),
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), editedAt: record.editedAt?.toISOString() ?? null,
    comments: await Promise.all(record.comments.map((comment) => toCommentDto(comment, actorId, ownerId, redactEmail))),
    permissions: { canEdit: actorId === record.createdByUserId, canDelete: Boolean(actorId && (actorId === record.createdByUserId || actorId === ownerId)) },
  }
}

async function toCommentDto(record: MessageCommentRecord, actorId: string | null, ownerId: string, redactEmail: boolean): Promise<DriveMessageCommentDto> {
  return {
    id: record.id, messageId: record.messageId, parentCommentId: record.parentCommentId, body: record.body,
    bodyHtml: (await renderDriveMarkdownFragment(record.body)).html,
    author: toAuthor(record.createdByUser, redactEmail),
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(), editedAt: record.editedAt?.toISOString() ?? null,
    permissions: { canEdit: actorId === record.createdByUserId, canDelete: Boolean(actorId && (actorId === record.createdByUserId || actorId === ownerId)) },
  }
}

function toAuthor(actor: MessageActor, redactEmail: boolean) {
  return { id: actor.id, email: redactEmail ? null : actor.email, handle: actor.handle }
}
