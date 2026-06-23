import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type {
  DriveAnnotationCommentDto,
  DriveAnnotationCommentUpdateInput,
  DriveAnnotationCreateInput,
  DriveAnnotationReplyInput,
  DriveAnnotationTargetDto,
  DriveAnnotationThreadDto,
} from "@synapse/shared"
import { PrismaService } from "../prisma/prisma.service"
import { isCommentableMarkdownItem } from "./drive-annotation-target"
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
  readonly canWrite: boolean
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
  ) {}

  async listOwnerAnnotations(userId: string, itemId: string): Promise<DriveAnnotationThreadDto[]> {
    const item = await this.requireOwnerItem(userId, itemId)
    const threads = await this.prisma.driveAnnotationThread.findMany({
      where: { itemId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: annotationInclude,
    })
    return toVisibleThreadDtos(threads, userId, item.userId)
  }

  async createOwnerAnnotation(userId: string, itemId: string, input: DriveAnnotationCreateInput): Promise<DriveAnnotationThreadDto> {
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
    return toThreadDto(thread, userId, item.userId)
  }

  async replyOwnerAnnotation(userId: string, itemId: string, threadId: string, input: DriveAnnotationReplyInput): Promise<DriveAnnotationCommentDto> {
    await this.requireOwnerItem(userId, itemId)
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
    return toCommentDto(comment, userId)
  }

  async updateOwnerComment(userId: string, itemId: string, commentId: string, input: DriveAnnotationCommentUpdateInput): Promise<DriveAnnotationCommentDto> {
    await this.requireOwnerItem(userId, itemId)
    const comment = await this.requireComment(itemId, commentId)
    if (comment.createdByUserId !== userId) throw new ForbiddenException("不能编辑他人的评论。")
    const updated = await this.prisma.driveAnnotationComment.update({
      where: { id: commentId },
      data: { body: input.body, editedAt: new Date() },
      include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
    })
    return toCommentDto(updated, userId)
  }

  async deleteOwnerComment(userId: string, itemId: string, commentId: string): Promise<{ readonly ok: true }> {
    await this.requireOwnerItem(userId, itemId)
    const comment = await this.requireComment(itemId, commentId)
    if (comment.createdByUserId !== userId) throw new ForbiddenException("不能删除该评论。")
    await this.prisma.driveAnnotationComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  async deleteOwnerThread(userId: string, itemId: string, threadId: string): Promise<{ readonly ok: true }> {
    const item = await this.requireOwnerItem(userId, itemId)
    if (item.userId !== userId) throw new ForbiddenException("不能删除该评论。")
    await this.requireThread(itemId, threadId)
    await this.prisma.driveAnnotationThread.update({ where: { id: threadId }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  async listShareAnnotations(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly actorUserId?: string | null
  }): Promise<DriveAnnotationThreadDto[]> {
    const { item, canWrite } = await this.resolveShareAnnotationAccess(input)
    const threads = await this.prisma.driveAnnotationThread.findMany({
      where: { itemId: item.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: annotationInclude,
    })
    return toVisibleThreadDtos(threads, input.actorUserId ?? null, item.userId, canWrite, true)
  }

  async createShareAnnotation(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly body: DriveAnnotationCreateInput
  }): Promise<DriveAnnotationThreadDto> {
    const item = await this.requireWritableShareItem(input)
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
    return toThreadDto(thread, input.actorUserId, item.userId)
  }

  async replyShareAnnotation(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly threadId: string
    readonly body: DriveAnnotationReplyInput
  }): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireWritableShareItem(input)
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
    return toCommentDto(comment, input.actorUserId)
  }

  async updateShareComment(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly commentId: string
    readonly body: DriveAnnotationCommentUpdateInput
  }): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireWritableShareItem(input)
    const comment = await this.requireComment(item.id, input.commentId)
    if (comment.createdByUserId !== input.actorUserId) throw new ForbiddenException("不能编辑他人的评论。")
    const updated = await this.prisma.driveAnnotationComment.update({
      where: { id: input.commentId },
      data: { body: input.body.body, editedAt: new Date() },
      include: { createdByUser: { select: { id: true, email: true, displayName: true } } },
    })
    return toCommentDto(updated, input.actorUserId)
  }

  async deleteShareComment(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly commentId: string
  }): Promise<{ readonly ok: true }> {
    const item = await this.requireWritableShareItem(input)
    const comment = await this.requireComment(item.id, input.commentId)
    if (comment.createdByUserId !== input.actorUserId) throw new ForbiddenException("不能删除该评论。")
    await this.prisma.driveAnnotationComment.update({ where: { id: input.commentId }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  async deleteShareThread(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly threadId: string
  }): Promise<{ readonly ok: true }> {
    const item = await this.requireWritableShareItem(input)
    if (item.userId !== input.actorUserId) throw new ForbiddenException("不能删除该评论。")
    await this.requireThread(item.id, input.threadId)
    await this.prisma.driveAnnotationThread.update({ where: { id: input.threadId }, data: { deletedAt: new Date() } })
    return { ok: true }
  }

  private async requireOwnerItem(userId: string, itemId: string): Promise<DriveAnnotationItem> {
    const item = await this.prisma.driveItem.findFirst({
      where: { id: itemId, userId, deletedAt: null },
      select: { id: true, userId: true, name: true, type: true, mimeType: true, storageKey: true },
    })
    if (!item) throw new NotFoundException("文件未找到")
    return item
  }

  private async requireWritableShareItem(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly actorUserId: string
  }): Promise<DriveAnnotationItem> {
    const access = await this.resolveShareAnnotationAccess(input)
    if (!access.canWrite) throw new ForbiddenException("没有编辑权限。")
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
    return { item, canWrite: Boolean(snapshot.edit?.canEdit) }
  }

  private async requireThread(itemId: string, threadId: string) {
    const thread = await this.prisma.driveAnnotationThread.findFirst({ where: { id: threadId, itemId, deletedAt: null } })
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
  return {
    id: record.id,
    itemId: record.itemId,
    baseVersionId: record.baseVersionId,
    targetKind: "textRange",
    target: record.target as DriveAnnotationTargetDto,
    anchorStatus: record.anchorStatus === "shifted" || record.anchorStatus === "orphaned" ? record.anchorStatus : "attached",
    author: toAuthorDto(record.createdByUser, redactAuthorEmail),
    comments: visibleComments(record.comments).map((comment) => toCommentDto(comment, actorUserId, canWrite, redactAuthorEmail)),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: { canDelete: canWrite && Boolean(actorUserId && actorUserId === fileOwnerUserId) },
  }
}

function visibleComments(comments: readonly AnnotationCommentRecord[]): readonly AnnotationCommentRecord[] {
  const parentIds = new Set(comments.map((comment) => comment.parentCommentId).filter((id): id is string => Boolean(id)))
  return comments.filter((comment) => !comment.deletedAt || parentIds.has(comment.id))
}

function toCommentDto(
  record: AnnotationCommentRecord,
  actorUserId: string | null,
  canWrite = true,
  redactAuthorEmail = false,
): DriveAnnotationCommentDto {
  const deleted = Boolean(record.deletedAt)
  const isAuthor = actorUserId === record.createdByUserId
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
      canDelete: canWrite && !deleted && isAuthor,
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
