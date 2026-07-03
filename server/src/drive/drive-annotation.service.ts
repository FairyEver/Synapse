import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type {
  DriveAnnotationCommentDto,
  DriveAnnotationCommentUpdateInput,
  DriveAnnotationCreateInput,
  DriveAnnotationReplyInput,
  DriveAnnotationTargetDto,
  DriveAnnotationThreadDto,
} from "@synapse/shared"
import { formatAuditError } from "../common/audit-error"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import { isCommentableMarkdownItem } from "./drive-annotation-target"
import { DRIVE_ITEM_LIFECYCLE_STATUS, DRIVE_STORAGE_STATUS } from "./drive.constants"
import { DriveService } from "./drive.service"

type DriveAnnotationItem = {
  readonly id: string
  readonly userId: string
  readonly name: string
  readonly type: string
  readonly mimeType: string | null
  readonly storageKey: string | null
}

type ShareAnnotationAccess = {
  readonly item: DriveAnnotationItem
  readonly canComment: boolean
}

type DriveAuditContext = {
  readonly ipAddress?: string
}

type AnnotationThreadRecord = {
  readonly id: string
  readonly itemId: string
  readonly baseVersionId: string | null
  readonly targetKind: string
  readonly target: unknown
  readonly anchorStatus: string
  readonly createdByUserId: string
  readonly createdByUser: { readonly id: string; readonly email: string; readonly displayName: string | null }
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly comments: readonly AnnotationCommentRecord[]
}

type AnnotationCommentRecord = {
  readonly id: string
  readonly threadId: string
  readonly parentCommentId: string | null
  readonly body: string
  readonly createdByUserId: string
  readonly createdByUser: { readonly id: string; readonly email: string; readonly displayName: string | null }
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly editedAt: Date | null
  readonly deletedAt: Date | null
}

type AnnotationAuthorRecord = {
  readonly id: string
  readonly email: string
  readonly displayName: string | null
}

const annotationInclude = {
  createdByUser: { select: { id: true, email: true, displayName: true } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
  },
} as const

@Injectable()
export class DriveAnnotationService {
  private readonly logger = new Logger(DriveAnnotationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async listOwnerAnnotations(userId: string, itemId: string): Promise<DriveAnnotationThreadDto[]> {
    const item = await this.requireOwnerItem(userId, itemId)
    const currentVersionId = await this.findCurrentVersionId(item)
    const threads = await this.prisma.driveAnnotationThread.findMany({
      where: { itemId, baseVersionId: currentVersionId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: annotationInclude,
    })
    return toVisibleThreadDtos(threads, userId, item.userId)
  }

  async createOwnerAnnotation(userId: string, itemId: string, input: DriveAnnotationCreateInput, auditContext: DriveAuditContext = {}): Promise<DriveAnnotationThreadDto> {
    const item = await this.requireOwnerItem(userId, itemId)
    assertCommentableItem(item)
    const baseVersionId = await this.resolveAnnotationBaseVersionId(item, input.baseVersionId ?? null)
    const thread = await this.prisma.driveAnnotationThread.create({
      data: {
        itemId,
        baseVersionId,
        targetKind: input.targetKind,
        target: input.target as unknown as Prisma.InputJsonValue,
        anchorStatus: "attached",
        createdByUserId: userId,
        comments: { create: { body: input.body, createdByUserId: userId } },
      },
      include: annotationInclude,
    })
    await this.recordAnnotationAudit({
      actorUserId: userId,
      action: "drive.annotation.create",
      targetType: "drive.annotationThread",
      targetId: thread.id,
      detail: {
        actorUserId: userId,
        ownerId: item.userId,
        itemId: item.id,
        threadId: thread.id,
        commentId: thread.comments[0]?.id ?? null,
        baseVersionId,
      },
      ipAddress: auditContext.ipAddress,
    })
    return toThreadDto(thread, userId, item.userId)
  }

  async replyOwnerAnnotation(userId: string, itemId: string, threadId: string, input: DriveAnnotationReplyInput, auditContext: DriveAuditContext = {}): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireOwnerItem(userId, itemId)
    await this.requireThread(itemId, threadId)
    await this.requireParentComment(threadId, input.parentCommentId ?? null)
    const comment = await this.prisma.driveAnnotationComment.create({
      data: {
        threadId,
        parentCommentId: input.parentCommentId ?? null,
        body: input.body,
        createdByUserId: userId,
      },
      include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
    })
    await this.recordAnnotationAudit({
      actorUserId: userId,
      action: "drive.annotation.reply",
      targetType: "drive.annotationComment",
      targetId: comment.id,
      detail: {
        actorUserId: userId,
        ownerId: item.userId,
        itemId: item.id,
        threadId,
        commentId: comment.id,
        parentCommentId: input.parentCommentId ?? null,
      },
      ipAddress: auditContext.ipAddress,
    })
    return toCommentDto(comment, userId, item.userId)
  }

  async updateOwnerComment(userId: string, itemId: string, commentId: string, input: DriveAnnotationCommentUpdateInput, auditContext: DriveAuditContext = {}): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireOwnerItem(userId, itemId)
    const comment = await this.requireComment(itemId, commentId)
    if (comment.createdByUserId !== userId) throw new ForbiddenException("不能编辑他人的评论。")
    const updated = await this.prisma.driveAnnotationComment.update({
      where: { id: commentId },
      data: { body: input.body, editedAt: new Date() },
      include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
    })
    await this.recordAnnotationAudit({
      actorUserId: userId,
      action: "drive.annotation.comment.edit",
      targetType: "drive.annotationComment",
      targetId: updated.id,
      detail: {
        actorUserId: userId,
        ownerId: item.userId,
        itemId: item.id,
        threadId: comment.threadId,
        commentId: updated.id,
      },
      ipAddress: auditContext.ipAddress,
    })
    return toCommentDto(updated, userId, item.userId)
  }

  async deleteOwnerComment(userId: string, itemId: string, commentId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const item = await this.requireOwnerItem(userId, itemId)
    if (item.userId !== userId) throw new ForbiddenException("不能删除该评论。")
    const comment = await this.requireComment(itemId, commentId)
    await this.prisma.driveAnnotationComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } })
    await this.recordAnnotationAudit({
      actorUserId: userId,
      action: "drive.annotation.comment.delete",
      targetType: "drive.annotationComment",
      targetId: commentId,
      detail: {
        actorUserId: userId,
        ownerId: item.userId,
        itemId: item.id,
        threadId: comment.threadId,
        commentId,
      },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true }
  }

  async deleteOwnerThread(userId: string, itemId: string, threadId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const item = await this.requireOwnerItem(userId, itemId)
    if (item.userId !== userId) throw new ForbiddenException("不能删除该评论。")
    await this.requireThread(itemId, threadId)
    await this.prisma.driveAnnotationThread.update({ where: { id: threadId }, data: { deletedAt: new Date() } })
    await this.recordAnnotationAudit({
      actorUserId: userId,
      action: "drive.annotation.thread.delete",
      targetType: "drive.annotationThread",
      targetId: threadId,
      detail: {
        actorUserId: userId,
        ownerId: item.userId,
        itemId: item.id,
        threadId,
      },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true }
  }

  async listShareAnnotations(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly actorUserId?: string | null
  }): Promise<DriveAnnotationThreadDto[]> {
    const { item, canComment } = await this.resolveShareAnnotationAccess(input)
    const currentVersionId = await this.findCurrentVersionId(item)
    const threads = await this.prisma.driveAnnotationThread.findMany({
      where: { itemId: item.id, baseVersionId: currentVersionId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: annotationInclude,
    })
    return toVisibleThreadDtos(threads, input.actorUserId ?? null, item.userId, canComment, true)
  }

  async createShareAnnotation(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly body: DriveAnnotationCreateInput
    readonly auditContext?: DriveAuditContext
  }): Promise<DriveAnnotationThreadDto> {
    const item = await this.requireCommentableShareItem(input)
    assertCommentableItem(item)
    const baseVersionId = await this.resolveAnnotationBaseVersionId(item, input.body.baseVersionId ?? null)
    const thread = await this.prisma.driveAnnotationThread.create({
      data: {
        itemId: item.id,
        baseVersionId,
        targetKind: input.body.targetKind,
        target: input.body.target as unknown as Prisma.InputJsonValue,
        anchorStatus: "attached",
        createdByUserId: input.actorUserId,
        comments: { create: { body: input.body.body, createdByUserId: input.actorUserId } },
      },
      include: annotationInclude,
    })
    await this.recordShareAnnotationAudit({
      actorUserId: input.actorUserId,
      shareId: input.shareId,
      action: "drive.share_annotation.create",
      targetType: "drive.annotationThread",
      targetId: thread.id,
      detail: {
        ownerId: item.userId,
        itemId: item.id,
        threadId: thread.id,
        commentId: thread.comments[0]?.id ?? null,
        baseVersionId,
      },
      ipAddress: input.auditContext?.ipAddress,
    })
    return toThreadDto(thread, input.actorUserId, item.userId)
  }

  async replyShareAnnotation(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly threadId: string
    readonly body: DriveAnnotationReplyInput
    readonly auditContext?: DriveAuditContext
  }): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireCommentableShareItem(input)
    await this.requireThread(item.id, input.threadId)
    await this.requireParentComment(input.threadId, input.body.parentCommentId ?? null)
    const comment = await this.prisma.driveAnnotationComment.create({
      data: {
        threadId: input.threadId,
        parentCommentId: input.body.parentCommentId ?? null,
        body: input.body.body,
        createdByUserId: input.actorUserId,
      },
      include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
    })
    await this.recordShareAnnotationAudit({
      actorUserId: input.actorUserId,
      shareId: input.shareId,
      action: "drive.share_annotation.reply",
      targetType: "drive.annotationComment",
      targetId: comment.id,
      detail: {
        ownerId: item.userId,
        itemId: item.id,
        threadId: input.threadId,
        commentId: comment.id,
        parentCommentId: input.body.parentCommentId ?? null,
      },
      ipAddress: input.auditContext?.ipAddress,
    })
    return toCommentDto(comment, input.actorUserId, item.userId)
  }

  async updateShareComment(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly commentId: string
    readonly body: DriveAnnotationCommentUpdateInput
    readonly auditContext?: DriveAuditContext
  }): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireCommentableShareItem(input)
    const comment = await this.requireComment(item.id, input.commentId)
    if (comment.createdByUserId !== input.actorUserId) throw new ForbiddenException("不能编辑他人的评论。")
    const updated = await this.prisma.driveAnnotationComment.update({
      where: { id: input.commentId },
      data: { body: input.body.body, editedAt: new Date() },
      include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
    })
    await this.recordShareAnnotationAudit({
      actorUserId: input.actorUserId,
      shareId: input.shareId,
      action: "drive.share_annotation.comment.edit",
      targetType: "drive.annotationComment",
      targetId: updated.id,
      detail: {
        ownerId: item.userId,
        itemId: item.id,
        threadId: comment.threadId,
        commentId: updated.id,
      },
      ipAddress: input.auditContext?.ipAddress,
    })
    return toCommentDto(updated, input.actorUserId, item.userId)
  }

  async deleteShareComment(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly commentId: string
    readonly auditContext?: DriveAuditContext
  }): Promise<{ readonly ok: true }> {
    const item = await this.requireCommentableShareItem(input)
    const comment = await this.requireComment(item.id, input.commentId)
    if (comment.createdByUserId !== input.actorUserId && item.userId !== input.actorUserId) throw new ForbiddenException("不能删除该评论。")
    await this.prisma.driveAnnotationComment.update({ where: { id: input.commentId }, data: { deletedAt: new Date() } })
    await this.recordShareAnnotationAudit({
      actorUserId: input.actorUserId,
      shareId: input.shareId,
      action: "drive.share_annotation.comment.delete",
      targetType: "drive.annotationComment",
      targetId: input.commentId,
      detail: {
        ownerId: item.userId,
        itemId: item.id,
        threadId: comment.threadId,
        commentId: input.commentId,
      },
      ipAddress: input.auditContext?.ipAddress,
    })
    return { ok: true }
  }

  async deleteShareThread(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly threadId: string
    readonly auditContext?: DriveAuditContext
  }): Promise<{ readonly ok: true }> {
    const item = await this.requireCommentableShareItem(input)
    const thread = await this.requireThread(item.id, input.threadId)
    if (!canDeleteThread(thread, visibleComments(thread.comments), input.actorUserId, item.userId)) {
      throw new ForbiddenException("不能删除该评论。")
    }
    await this.prisma.driveAnnotationThread.update({ where: { id: input.threadId }, data: { deletedAt: new Date() } })
    await this.recordShareAnnotationAudit({
      actorUserId: input.actorUserId,
      shareId: input.shareId,
      action: "drive.share_annotation.thread.delete",
      targetType: "drive.annotationThread",
      targetId: input.threadId,
      detail: {
        ownerId: item.userId,
        itemId: item.id,
        threadId: input.threadId,
      },
      ipAddress: input.auditContext?.ipAddress,
    })
    return { ok: true }
  }

  private async requireOwnerItem(userId: string, itemId: string): Promise<DriveAnnotationItem> {
    const item = await this.prisma.driveItem.findFirst({
      where: {
        id: itemId,
        userId,
        storageStatus: DRIVE_STORAGE_STATUS.active,
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
        deletedAt: null,
      },
      select: { id: true, userId: true, name: true, type: true, mimeType: true, storageKey: true },
    })
    if (!item) throw new NotFoundException("文件未找到")
    return item
  }

  private async requireCommentableShareItem(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly actorUserId: string
  }): Promise<DriveAnnotationItem> {
    const access = await this.resolveShareAnnotationAccess(input)
    if (!access.canComment) throw new ForbiddenException("没有评论权限。")
    return access.item
  }

  private async resolveShareAnnotationAccess(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly actorUserId?: string | null
  }): Promise<ShareAnnotationAccess> {
    const snapshot = await this.drive.getShareBrowserSnapshot({
      shareId: input.shareId,
      itemId: input.itemId,
      cookie: input.cookie ?? undefined,
      actorUserId: input.actorUserId ?? null,
    })
    const item = await this.prisma.driveItem.findFirst({
      where: { id: snapshot.current.id, deletedAt: null },
      select: { id: true, userId: true, name: true, type: true, mimeType: true, storageKey: true },
    })
    if (!item) throw new NotFoundException("文件未找到")
    return { item, canComment: Boolean(snapshot.annotation?.canComment) }
  }

  private async requireThread(itemId: string, threadId: string): Promise<AnnotationThreadRecord> {
    const thread = await this.prisma.driveAnnotationThread.findFirst({ where: { id: threadId, itemId, deletedAt: null }, include: annotationInclude })
    if (!thread) throw new NotFoundException("评论不存在。")
    return thread
  }

  private async requireParentComment(threadId: string, parentCommentId: string | null): Promise<void> {
    if (!parentCommentId) return
    const comment = await this.prisma.driveAnnotationComment.findFirst({
      where: { id: parentCommentId, threadId, deletedAt: null },
      select: { id: true },
    })
    if (!comment) throw new BadRequestException("回复目标不存在。")
  }

  private async requireComment(itemId: string, commentId: string) {
    const comment = await this.prisma.driveAnnotationComment.findFirst({
      where: { id: commentId, thread: { itemId, deletedAt: null }, deletedAt: null },
    })
    if (!comment) throw new NotFoundException("评论不存在。")
    return comment
  }

  private async findCurrentVersionId(item: {
    readonly id: string
    readonly type: string
    readonly storageKey: string | null
  }): Promise<string | null> {
    if (item.type !== "file" || !item.storageKey) return null
    const version = await this.prisma.driveFileVersion.findFirst({
      where: { itemId: item.id, storageKey: item.storageKey, deletedAt: null },
      select: { id: true },
    })
    return version?.id ?? null
  }

  private async resolveAnnotationBaseVersionId(item: DriveAnnotationItem, requestedBaseVersionId: string | null): Promise<string | null> {
    const currentVersionId = await this.findCurrentVersionId(item)
    if (requestedBaseVersionId && requestedBaseVersionId !== currentVersionId) {
      throw new ConflictException("文件已有新内容。")
    }
    return currentVersionId
  }

  private async recordShareAnnotationAudit(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly action: string
    readonly targetType: string
    readonly targetId: string
    readonly detail: Record<string, unknown>
    readonly ipAddress?: string
  }): Promise<void> {
    if (!this.auditLog) return
    let shareRecordId: string | null = null
    try {
      const share = await this.prisma.driveShare.findFirst({
        where: { shareId: input.shareId },
        select: { id: true },
      })
      shareRecordId = share?.id ?? null
    } catch (error) {
      this.logger.warn({
        shareIdLength: input.shareId.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Drive annotation share audit context lookup failed")
    }
    await this.recordAnnotationAudit({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: {
        actorUserId: input.actorUserId,
        shareId: input.shareId,
        shareRecordId,
        ...input.detail,
      },
      ipAddress: input.ipAddress,
    })
  }

  private async recordAnnotationAudit(input: {
    readonly actorUserId: string
    readonly action: string
    readonly targetType: string
    readonly targetId: string
    readonly detail: Record<string, unknown>
    readonly ipAddress?: string
  }): Promise<void> {
    if (!this.auditLog) return
    try {
      const user = await this.prisma.user.findUnique({ where: { id: input.actorUserId }, select: { email: true } })
      await this.auditLog.record({
        adminEmail: user?.email ?? input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: redactAnnotationAuditDetail(input.detail),
        ipAddress: input.ipAddress ?? "system",
      })
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Drive annotation audit log write failed")
    }
  }
}

function assertCommentableItem(item: { readonly name: string; readonly type: string; readonly mimeType: string | null }) {
  if (!isCommentableMarkdownItem(item)) throw new BadRequestException("该文件暂不支持评论。")
}

function toVisibleThreadDtos(
  records: readonly AnnotationThreadRecord[],
  actorUserId: string | null,
  fileOwnerUserId: string,
  canWrite = true,
  redactAuthorEmail = false,
): DriveAnnotationThreadDto[] {
  return records
    .map((record) => toThreadDto(record, actorUserId, fileOwnerUserId, canWrite, redactAuthorEmail))
    .filter((thread) => thread.comments.length > 0)
}

function toThreadDto(
  record: AnnotationThreadRecord,
  actorUserId: string | null,
  fileOwnerUserId: string,
  canWrite = true,
  redactAuthorEmail = false,
): DriveAnnotationThreadDto {
  const comments = visibleComments(record.comments)
  return {
    id: record.id,
    itemId: record.itemId,
    baseVersionId: record.baseVersionId,
    targetKind: "textRange",
    target: record.target as DriveAnnotationTargetDto,
    anchorStatus: record.anchorStatus === "shifted" || record.anchorStatus === "orphaned" ? record.anchorStatus : "attached",
    author: toAuthorDto(record.createdByUser, redactAuthorEmail),
    comments: comments.map((comment) => toCommentDto(comment, actorUserId, fileOwnerUserId, canWrite, redactAuthorEmail)),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: { canDelete: canDeleteThread(record, comments, actorUserId, fileOwnerUserId, canWrite) },
  }
}

function canDeleteThread(
  record: Pick<AnnotationThreadRecord, "createdByUserId">,
  comments: readonly AnnotationCommentRecord[],
  actorUserId: string | null,
  fileOwnerUserId: string,
  canWrite = true,
): boolean {
  if (!canWrite || !actorUserId) return false
  if (actorUserId === fileOwnerUserId) return true
  if (record.createdByUserId !== actorUserId) return false
  return comments.every((comment) => comment.createdByUserId === actorUserId)
}

function visibleComments(comments: readonly AnnotationCommentRecord[]): readonly AnnotationCommentRecord[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]))
  const visibleIds = new Set(comments.filter((comment) => !comment.deletedAt).map((comment) => comment.id))
  for (const comment of comments) {
    if (!visibleIds.has(comment.id)) continue
    let parentCommentId = comment.parentCommentId
    while (parentCommentId) {
      if (visibleIds.has(parentCommentId)) break
      const parent = byId.get(parentCommentId)
      if (!parent) break
      visibleIds.add(parent.id)
      parentCommentId = parent.parentCommentId
    }
  }
  return comments.filter((comment) => visibleIds.has(comment.id))
}

function toCommentDto(
  record: AnnotationCommentRecord,
  actorUserId: string | null,
  fileOwnerUserId: string,
  canWrite = true,
  redactAuthorEmail = false,
): DriveAnnotationCommentDto {
  const deleted = Boolean(record.deletedAt)
  const isAuthor = actorUserId === record.createdByUserId
  const isFileOwner = actorUserId === fileOwnerUserId
  return {
    id: record.id,
    threadId: record.threadId,
    parentCommentId: record.parentCommentId,
    body: deleted ? "" : record.body,
    author: toAuthorDto(record.createdByUser, redactAuthorEmail),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    editedAt: record.editedAt?.toISOString() ?? null,
    deletedAt: record.deletedAt?.toISOString() ?? null,
    deleted,
    permissions: {
      canEdit: canWrite && !deleted && isAuthor,
      canDelete: canWrite && !deleted && (isAuthor || isFileOwner),
    },
  }
}

function toAuthorDto(record: AnnotationAuthorRecord, redactEmail: boolean) {
  return {
    id: record.id,
    email: redactEmail ? null : record.email,
    displayName: record.displayName,
  }
}

function redactAnnotationAuditDetail(value: Record<string, unknown>): Record<string, unknown> {
  return redactAnnotationAuditValue(value) as Record<string, unknown>
}

function redactAnnotationAuditValue(value: unknown): unknown {
  if (typeof value === "string") {
    return isPublicDriveShareId(value) ? "[redacted-share-id]" : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAnnotationAuditValue(item))
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
    key,
    key === "shareId" || key === "requestedShareId"
      ? redactAnnotationAuditShareValue(entryValue)
      : redactAnnotationAuditValue(entryValue),
  ]))
}

function redactAnnotationAuditShareValue(value: unknown): unknown {
  return typeof value === "string" ? "[redacted-share-id]" : redactAnnotationAuditValue(value)
}

function isPublicDriveShareId(value: string): boolean {
  return /^shr_[A-Za-z0-9]+$/u.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]"
}
