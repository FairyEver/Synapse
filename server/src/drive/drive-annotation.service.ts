import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type {
  DriveAnnotationAnchorDto,
  DriveAnnotationCommentDto,
  DriveAnnotationCommentUpdateInput,
  DriveAnnotationCreateInput,
  DriveAnnotationReplyInput,
  DriveAnnotationTargetDto,
  DriveAnnotationThreadDto,
  DriveAnnotationSelectorsV2,
  DriveAnnotationTextPositionSelector,
  DriveAnnotationTextSelectorsV2,
  DriveLinkAnnotationTargetInput,
} from "@synapse/shared"
import { resolveDriveAnnotationAnchor, resolveDriveImageAnnotationAnchor } from "@synapse/shared"
import { formatAuditError } from "../common/audit-error"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import { isCommentableMarkdownItem, toDriveAnnotationSelectorsV2 } from "./drive-annotation-target"
import { DRIVE_ITEM_LIFECYCLE_STATUS, DRIVE_STORAGE_STATUS } from "./drive.constants"
import { DriveService } from "./drive.service"
import { LocalDriveCollaborationBus } from "./drive-collaboration-bus"

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
  readonly createdByUser: { readonly id: string; readonly email: string; readonly handle: string | null }
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly comments: readonly AnnotationCommentRecord[]
  readonly anchor?: AnnotationAnchorRecord | null
}

type AnnotationAnchorRecord = {
  readonly schemaVersion: number
  readonly baseVersionId: string | null
  readonly selectors: unknown
  readonly positionStatus: string
  readonly quoteStatus: string
  readonly lastResolvedVersionId: string | null
  readonly resolvedSourceStart: number | null
  readonly resolvedSourceEnd: number | null
  readonly resolvedRenderedStart: number | null
  readonly resolvedRenderedEnd: number | null
  readonly confidence: number | null
}

type AnnotationCommentRecord = {
  readonly id: string
  readonly threadId: string
  readonly parentCommentId: string | null
  readonly body: string
  readonly createdByUserId: string
  readonly createdByUser: { readonly id: string; readonly email: string; readonly handle: string | null }
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly editedAt: Date | null
  readonly deletedAt: Date | null
}

type AnnotationAuthorRecord = {
  readonly id: string
  readonly email: string
  readonly handle: string | null
}

const annotationInclude = {
  anchor: true,
  createdByUser: { select: { id: true, email: true, handle: true } },
  comments: {
    orderBy: { createdAt: "asc" as const },
    include: { createdByUser: { select: { id: true, email: true, handle: true } } },
  },
} as const

@Injectable()
export class DriveAnnotationService {
  private readonly logger = new Logger(DriveAnnotationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly collaborationBus?: LocalDriveCollaborationBus,
  ) {}

  async listOwnerAnnotations(userId: string, itemId: string): Promise<DriveAnnotationThreadDto[]> {
    const item = await this.requireOwnerItem(userId, itemId)
    const threads = await this.prisma.driveAnnotationThread.findMany({
      where: { itemId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: annotationInclude,
    })
    return toVisibleThreadDtos(await this.refreshThreadAnchors(item, threads), userId, item.userId)
  }

  async createOwnerAnnotation(userId: string, itemId: string, input: DriveAnnotationCreateInput, auditContext: DriveAuditContext = {}): Promise<DriveAnnotationThreadDto> {
    const item = await this.requireOwnerItem(userId, itemId)
    assertCommentableItem(item)
    const baseVersionId = await this.resolveAnnotationBaseVersionId(item, input.baseVersionId ?? null)
    const anchor = await this.validateAnchorInput(item, input, baseVersionId)
    const existing = input.idempotencyKey
      ? await this.findThreadByIdempotencyKey(item.id, input.idempotencyKey)
      : null
    if (existing) return toThreadDto(existing, userId, item.userId)
    const thread = await this.prisma.driveAnnotationThread.create({
      data: {
        itemId,
        baseVersionId,
        targetKind: input.targetKind,
        target: input.target as unknown as Prisma.InputJsonValue,
        anchorStatus: "attached",
        createdByUserId: userId,
        anchor: { create: buildAnchorCreateData(item.id, baseVersionId, anchor.selectors, anchor.resolution, input.idempotencyKey) },
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
    this.notifyAnnotationChanged(item.id)
    return toThreadDto(thread, userId, item.userId)
  }

  async replyOwnerAnnotation(userId: string, itemId: string, threadId: string, input: DriveAnnotationReplyInput, auditContext: DriveAuditContext = {}): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireOwnerItem(userId, itemId)
    const thread = await this.requireThread(item.id, threadId)
    await this.requireParentComment(threadId, input.parentCommentId ?? null)
    const comment = await this.prisma.driveAnnotationComment.create({
      data: {
        threadId,
        parentCommentId: input.parentCommentId ?? null,
        body: input.body,
        createdByUserId: userId,
      },
      include: { createdByUser: { select: { id: true, email: true, handle: true } } },
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
        baseVersionId: thread.baseVersionId,
      },
      ipAddress: auditContext.ipAddress,
    })
    this.notifyAnnotationChanged(item.id)
    return toCommentDto(comment, userId, item.userId)
  }

  async updateOwnerComment(userId: string, itemId: string, commentId: string, input: DriveAnnotationCommentUpdateInput, auditContext: DriveAuditContext = {}): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireOwnerItem(userId, itemId)
    const { comment, thread } = await this.requireCommentThread(item.id, commentId)
    if (comment.createdByUserId !== userId) throw new ForbiddenException("不能编辑他人的评论。")
    const updated = await this.prisma.driveAnnotationComment.update({
      where: { id: commentId },
      data: { body: input.body, editedAt: new Date() },
      include: { createdByUser: { select: { id: true, email: true, handle: true } } },
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
        baseVersionId: thread.baseVersionId,
      },
      ipAddress: auditContext.ipAddress,
    })
    this.notifyAnnotationChanged(item.id)
    return toCommentDto(updated, userId, item.userId)
  }

  async deleteOwnerComment(userId: string, itemId: string, commentId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const item = await this.requireOwnerItem(userId, itemId)
    if (item.userId !== userId) throw new ForbiddenException("不能删除该评论。")
    const { comment, thread } = await this.requireCommentThread(item.id, commentId)
    const deletion = await this.deleteCommentTree(comment, thread)
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
        deletedCommentCount: deletion.deletedCommentCount,
        threadDeleted: deletion.threadDeleted,
        baseVersionId: thread.baseVersionId,
      },
      ipAddress: auditContext.ipAddress,
    })
    this.notifyAnnotationChanged(item.id)
    return { ok: true }
  }

  async deleteOwnerThread(userId: string, itemId: string, threadId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const item = await this.requireOwnerItem(userId, itemId)
    if (item.userId !== userId) throw new ForbiddenException("不能删除该评论。")
    const thread = await this.requireThread(item.id, threadId)
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
        baseVersionId: thread.baseVersionId,
      },
      ipAddress: auditContext.ipAddress,
    })
    this.notifyAnnotationChanged(item.id)
    return { ok: true }
  }

  async listShareAnnotations(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly password?: string
    readonly actorUserId?: string | null
  }): Promise<readonly DriveAnnotationThreadDto[]> {
    return (await this.getShareAnnotationSnapshot(input)).threads
  }

  async getShareAnnotationSnapshot(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly password?: string
    readonly actorUserId?: string | null
  }): Promise<{ readonly itemId: string; readonly canComment: boolean; readonly threads: readonly DriveAnnotationThreadDto[] }> {
    const { item, canComment } = await this.resolveShareAnnotationAccess(input)
    const threads = await this.prisma.driveAnnotationThread.findMany({
      where: { itemId: item.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: annotationInclude,
    })
    return {
      itemId: item.id,
      canComment,
      threads: toVisibleThreadDtos(await this.refreshThreadAnchors(item, threads), input.actorUserId ?? null, item.userId, canComment, true),
    }
  }

  async createShareAnnotation(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly password?: string
    readonly body: DriveAnnotationCreateInput
    readonly auditContext?: DriveAuditContext
  }): Promise<DriveAnnotationThreadDto> {
    const item = await this.requireCommentableShareItem(input)
    assertCommentableItem(item)
    const baseVersionId = await this.resolveAnnotationBaseVersionId(item, input.body.baseVersionId ?? null)
    const anchor = await this.validateAnchorInput(item, input.body, baseVersionId)
    const existing = input.body.idempotencyKey
      ? await this.findThreadByIdempotencyKey(item.id, input.body.idempotencyKey)
      : null
    if (existing) return toThreadDto(existing, input.actorUserId, item.userId, true, true)
    const thread = await this.prisma.driveAnnotationThread.create({
      data: {
        itemId: item.id,
        baseVersionId,
        targetKind: input.body.targetKind,
        target: input.body.target as unknown as Prisma.InputJsonValue,
        anchorStatus: "attached",
        createdByUserId: input.actorUserId,
        anchor: { create: buildAnchorCreateData(item.id, baseVersionId, anchor.selectors, anchor.resolution, input.body.idempotencyKey) },
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
    this.notifyAnnotationChanged(item.id)
    return toThreadDto(thread, input.actorUserId, item.userId, true, true)
  }

  async createShareAnnotationByQuote(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly password?: string
    readonly target: DriveLinkAnnotationTargetInput
    readonly body: string
    readonly idempotencyKey: string
    readonly auditContext?: DriveAuditContext
  }): Promise<DriveAnnotationThreadDto> {
    const item = await this.requireCommentableShareItem(input)
    const anchorInput = await this.resolveQuoteAnchorInput(item, input.target, input.idempotencyKey)
    return this.createShareAnnotation({
      actorUserId: input.actorUserId,
      shareId: input.shareId,
      itemId: item.id,
      cookie: input.cookie,
      password: input.password,
      body: { ...anchorInput, body: input.body },
      auditContext: input.auditContext,
    })
  }

  async replyShareAnnotation(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly password?: string
    readonly threadId: string
    readonly body: DriveAnnotationReplyInput
    readonly auditContext?: DriveAuditContext
  }): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireCommentableShareItem(input)
    const thread = await this.requireThread(item.id, input.threadId)
    await this.requireParentComment(input.threadId, input.body.parentCommentId ?? null)
    const comment = await this.prisma.driveAnnotationComment.create({
      data: {
        threadId: input.threadId,
        parentCommentId: input.body.parentCommentId ?? null,
        body: input.body.body,
        createdByUserId: input.actorUserId,
      },
      include: { createdByUser: { select: { id: true, email: true, handle: true } } },
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
        baseVersionId: thread.baseVersionId,
      },
      ipAddress: input.auditContext?.ipAddress,
    })
    this.notifyAnnotationChanged(item.id)
    return toCommentDto(comment, input.actorUserId, item.userId, true, true)
  }

  async updateShareComment(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly password?: string
    readonly commentId: string
    readonly body: DriveAnnotationCommentUpdateInput
    readonly auditContext?: DriveAuditContext
  }): Promise<DriveAnnotationCommentDto> {
    const item = await this.requireCommentableShareItem(input)
    const { comment, thread } = await this.requireCommentThread(item.id, input.commentId)
    if (comment.createdByUserId !== input.actorUserId) throw new ForbiddenException("不能编辑他人的评论。")
    const updated = await this.prisma.driveAnnotationComment.update({
      where: { id: input.commentId },
      data: { body: input.body.body, editedAt: new Date() },
      include: { createdByUser: { select: { id: true, email: true, handle: true } } },
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
        baseVersionId: thread.baseVersionId,
      },
      ipAddress: input.auditContext?.ipAddress,
    })
    this.notifyAnnotationChanged(item.id)
    return toCommentDto(updated, input.actorUserId, item.userId, true, true)
  }

  async deleteShareComment(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly password?: string
    readonly commentId: string
    readonly auditContext?: DriveAuditContext
  }): Promise<{ readonly ok: true }> {
    const item = await this.requireCommentableShareItem(input)
    const { comment, thread } = await this.requireCommentThread(item.id, input.commentId)
    if (comment.createdByUserId !== input.actorUserId && item.userId !== input.actorUserId) throw new ForbiddenException("不能删除该评论。")
    const deletion = await this.deleteCommentTree(comment, thread)
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
        deletedCommentCount: deletion.deletedCommentCount,
        threadDeleted: deletion.threadDeleted,
        baseVersionId: thread.baseVersionId,
      },
      ipAddress: input.auditContext?.ipAddress,
    })
    this.notifyAnnotationChanged(item.id)
    return { ok: true }
  }

  async deleteShareThread(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string
    readonly cookie?: string | null
    readonly password?: string
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
        baseVersionId: thread.baseVersionId,
      },
      ipAddress: input.auditContext?.ipAddress,
    })
    this.notifyAnnotationChanged(item.id)
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
    readonly password?: string
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
    readonly password?: string
    readonly actorUserId?: string | null
  }): Promise<ShareAnnotationAccess> {
    return this.drive.resolveShareAnnotationAccess({
      shareId: input.shareId,
      itemId: input.itemId,
      password: input.password,
      cookie: input.cookie ?? undefined,
      actorUserId: input.actorUserId ?? null,
    })
  }

  private async requireThread(itemId: string, threadId: string): Promise<AnnotationThreadRecord> {
    const thread = await this.prisma.driveAnnotationThread.findFirst({ where: { id: threadId, itemId, deletedAt: null }, include: annotationInclude })
    if (!thread) throw new NotFoundException("评论不存在。")
    return thread
  }

  private notifyAnnotationChanged(itemId: string): void {
    this.collaborationBus?.publish(itemId, { type: "annotation.changed", itemId })
  }

  private async findThreadByIdempotencyKey(itemId: string, idempotencyKey: string): Promise<AnnotationThreadRecord | null> {
    return this.prisma.driveAnnotationThread.findFirst({
      where: { itemId, deletedAt: null, anchor: { idempotencyKey } },
      include: annotationInclude,
    })
  }

  private async resolveQuoteAnchorInput(
    item: DriveAnnotationItem,
    target: DriveLinkAnnotationTargetInput,
    idempotencyKey: string,
  ): Promise<Omit<DriveAnnotationCreateInput, "body">> {
    const document = await this.drive.resolveAnnotationDocument(item)
    if ("kind" in target && target.kind === "image") {
      const image = document.projection.images?.find((candidate) => candidate.imageId === target.imageId)
      if (!image) {
        throw new ConflictException({
          code: "DRIVE_ANNOTATION_TARGET_NOT_FOUND",
          message: "未找到图片，请重新读取文档。",
        })
      }
      return {
        baseVersionId: document.versionId,
        epoch: document.epoch,
        selectors: {
          schemaVersion: 2,
          kind: "image",
          position: { start: image.sourceStart, end: image.sourceEnd },
          semantic: {
            blockId: image.blockId,
            imageIndex: image.imageIndex,
            headingPath: document.projection.blocks.find((block) => block.blockId === image.blockId)?.headingPath ?? [],
          },
          identity: { imageId: image.imageId, resourceKey: image.resourceKey },
        },
        idempotencyKey,
        targetKind: "image",
        target: {
          schemaVersion: 1,
          kind: "image",
          surface: "markdownRenderedImage",
          imageId: image.imageId,
          resourceKey: image.resourceKey,
          source: { startOffset: image.sourceStart, endOffset: image.sourceEnd },
          snapshot: { src: image.source, alt: image.alt, title: image.title },
          blockHint: {
            blockId: image.blockId,
            blockIndex: Math.max(0, document.projection.blocks.findIndex((block) => block.blockId === image.blockId)),
            imageIndex: image.imageIndex,
            headingPath: document.projection.blocks.find((block) => block.blockId === image.blockId)?.headingPath ?? [],
          },
        },
      }
    }
    const quote = {
      exact: target.exact,
      prefix: target.prefix ?? "",
      suffix: target.suffix ?? "",
    }
    const exactLength = Array.from(quote.exact).length
    const initialSelectors: DriveAnnotationTextSelectorsV2 = {
      schemaVersion: 2,
      position: { start: 0, end: exactLength },
      renderedPosition: { start: 0, end: exactLength },
      quote,
    }
    const resolution = resolveDriveAnnotationAnchor({
      selectors: initialSelectors,
      projection: document.projection,
      sourceText: document.sourceText,
      renderedText: document.renderedText,
    })
    if (resolution.positionStatus === "ambiguous") {
      throw new ConflictException({
        code: "DRIVE_ANNOTATION_TARGET_AMBIGUOUS",
        message: "评论原文存在多个匹配位置，请补充前后文。",
      })
    }
    if (resolution.positionStatus !== "attached"
      || resolution.quoteStatus !== "exact"
      || !resolution.sourceRange
      || !resolution.renderedRange) {
      throw new ConflictException({
        code: "DRIVE_ANNOTATION_TARGET_NOT_FOUND",
        message: "未找到评论原文，请重新读取文档。",
      })
    }
    const renderedRange = resolution.renderedRange
    const block = document.projection.blocks
      .filter((candidate) => candidate.renderedStart <= renderedRange.start
        && candidate.renderedEnd >= renderedRange.end)
      .sort((left, right) => (left.renderedEnd - left.renderedStart) - (right.renderedEnd - right.renderedStart))[0]
    const selectors: DriveAnnotationTextSelectorsV2 = {
      schemaVersion: 2,
      position: resolution.sourceRange,
      renderedPosition: renderedRange,
      quote,
      ...(block
        ? {
            semantic: {
              blockId: block.blockId,
              start: renderedRange.start - block.renderedStart,
              end: renderedRange.end - block.renderedStart,
              blockType: block.type,
              headingPath: block.headingPath,
            },
          }
        : {}),
    }
    return {
      baseVersionId: document.versionId,
      epoch: document.epoch,
      selectors,
      idempotencyKey,
      targetKind: "textRange",
      target: {
        schemaVersion: 1,
        kind: "textRange",
        surface: "markdownRenderedText",
        range: codePointRangeToUtf16(document.renderedText, renderedRange),
        quote,
      },
    }
  }

  private async validateAnchorInput(item: DriveAnnotationItem, input: DriveAnnotationCreateInput, baseVersionId: string | null) {
    if (!baseVersionId) throw staleAnnotationConflict()
    const selectors = input.selectors ?? toDriveAnnotationSelectorsV2(input.target)
    if (input.targetKind !== input.target.kind) throw new BadRequestException("评论位置无效。")
    if (input.target.kind === "image") {
      if (selectors.kind !== "image"
        || selectors.identity.imageId !== input.target.imageId
        || selectors.identity.resourceKey !== input.target.resourceKey) {
        throw new BadRequestException("评论位置无效。")
      }
    } else if (selectors.kind === "image" || selectors.quote.exact !== input.target.quote.exact) {
      throw new BadRequestException("评论位置无效。")
    }
    return this.validateSelectors(item, baseVersionId, selectors, input.epoch ?? null)
  }

  private async validateSelectors(
    item: DriveAnnotationItem,
    baseVersionId: string,
    selectors: DriveAnnotationSelectorsV2,
    epoch: string | null,
  ) {
    const resolver = (this.drive as DriveService & {
      resolveAnnotationDocument?: DriveService["resolveAnnotationDocument"]
    }).resolveAnnotationDocument
    if (typeof resolver !== "function") {
      return {
        selectors,
        resolution: {
          positionStatus: "attached" as const,
          quoteStatus: "exact" as const,
          sourceRange: selectors.position,
          renderedRange: selectors.kind === "image" ? null : selectors.renderedPosition ?? null,
          confidence: 1,
        },
      }
    }
    const document = await resolver.call(this.drive, item)
    if (document.versionId !== baseVersionId || (epoch && document.epoch && epoch !== document.epoch)) {
      this.logger.warn({
        currentEpoch: document.epoch,
        currentVersionId: document.versionId,
        itemId: item.id,
        requestedEpoch: epoch,
        requestedVersionId: baseVersionId,
      }, "Drive annotation anchor revision validation failed")
      throw staleAnnotationConflict()
    }
    if (selectors.kind !== "image" && selectors.renderedPosition && !hasGraphemeBoundaries(document.renderedText, selectors.renderedPosition)) {
      throw new BadRequestException("评论位置无效。")
    }
    const crdtSourceRange = selectors.crdt
      ? this.drive.resolveAnnotationCrdtRange(item.id, selectors.crdt)
      : null
    const resolution = selectors.kind === "image"
      ? resolveDriveImageAnnotationAnchor({ selectors, projection: document.projection, crdtSourceRange })
      : resolveDriveAnnotationAnchor({
          selectors,
          projection: document.projection,
          sourceText: document.sourceText,
          renderedText: document.renderedText,
          crdtSourceRange,
        })
    if (resolution.positionStatus !== "attached" || resolution.quoteStatus !== "exact") {
      this.logger.warn({
        hasCrdtSelector: Boolean(selectors.crdt),
        hasSemanticSelector: Boolean(selectors.semantic),
        itemId: item.id,
        positionStatus: resolution.positionStatus,
        quoteStatus: resolution.quoteStatus,
      }, "Drive annotation anchor position validation failed")
      if (resolution.positionStatus === "ambiguous") {
        throw new ConflictException({
          code: "DRIVE_ANNOTATION_TARGET_AMBIGUOUS",
          message: "所选内容存在多个相同位置，请选择更多文字。",
        })
      }
      throw staleAnnotationConflict()
    }
    return { selectors, resolution }
  }

  private async refreshThreadAnchors(
    item: DriveAnnotationItem,
    threads: readonly AnnotationThreadRecord[],
  ): Promise<AnnotationThreadRecord[]> {
    const resolver = (this.drive as DriveService & {
      resolveAnnotationDocument?: DriveService["resolveAnnotationDocument"]
    }).resolveAnnotationDocument
    if (typeof resolver !== "function" || threads.length === 0) return [...threads]
    let document: Awaited<ReturnType<DriveService["resolveAnnotationDocument"]>>
    try {
      document = await resolver.call(this.drive, item)
    } catch (error) {
      this.logger.warn({
        errorName: error instanceof Error ? error.name : typeof error,
        itemId: item.id,
      }, "Drive annotation anchor document resolution failed")
      return threads.map((thread) => ({ ...thread, anchor: unavailableAnchorRecord(thread) }))
    }
    const prepared = threads.map((thread) => {
      const selectors = parseAnchorSelectors(thread.anchor?.selectors) ?? toDriveAnnotationSelectorsV2(thread.target as DriveAnnotationTargetDto)
      const target = thread.target as DriveAnnotationTargetDto
      const hasReliableSourceRange = Boolean(selectors.crdt || selectors.semantic || target.source)
      return { thread, selectors, hasReliableSourceRange }
    })
    const diffSourceRangeByThreadId = new Map<string, DriveAnnotationTextPositionSelector | null>()
    const diffGroups = new Map<string, typeof prepared>()
    for (const entry of prepared) {
      if (!entry.thread.baseVersionId
        || entry.thread.baseVersionId === document.versionId
        || !entry.hasReliableSourceRange) continue
      const group = diffGroups.get(entry.thread.baseVersionId) ?? []
      group.push(entry)
      diffGroups.set(entry.thread.baseVersionId, group)
    }
    await Promise.all([...diffGroups.entries()].map(async ([baseVersionId, entries]) => {
      const ranges = await this.drive.resolveAnnotationDiffRanges(
        item.id,
        baseVersionId,
        document.sourceText,
        entries.map((entry) => entry.selectors.position),
      )
      entries.forEach((entry, index) => {
        diffSourceRangeByThreadId.set(entry.thread.id, ranges[index] ?? null)
      })
    }))
    return Promise.all(prepared.map(async ({ thread, selectors }) => {
      const diffSourceRange = diffSourceRangeByThreadId.get(thread.id) ?? null
      const crdtSourceRange = selectors.crdt
        ? this.drive.resolveAnnotationCrdtRange(item.id, selectors.crdt)
        : null
      const resolution = selectors.kind === "image"
        ? resolveDriveImageAnnotationAnchor({
            selectors,
            projection: document.projection,
            crdtSourceRange,
            diffSourceRange,
          })
        : resolveDriveAnnotationAnchor({
            selectors,
            projection: document.projection,
            sourceText: document.sourceText,
            renderedText: document.renderedText,
            crdtSourceRange,
            diffSourceRange,
          })
      const anchor = await this.prisma.driveAnnotationAnchor.upsert({
        where: { threadId: thread.id },
        create: { ...buildAnchorCreateData(thread.itemId, thread.baseVersionId, selectors, resolution), threadId: thread.id },
        update: {
          selectors: selectors as unknown as Prisma.InputJsonValue,
          positionStatus: resolution.positionStatus,
          quoteStatus: resolution.quoteStatus,
          lastResolvedVersionId: document.versionId,
          resolvedSourceStart: resolution.sourceRange?.start ?? null,
          resolvedSourceEnd: resolution.sourceRange?.end ?? null,
          resolvedRenderedStart: resolution.renderedRange?.start ?? null,
          resolvedRenderedEnd: resolution.renderedRange?.end ?? null,
          confidence: resolution.confidence,
        },
      })
      const legacyStatus = resolution.positionStatus === "attached" ? "attached" : "orphaned"
      if (thread.anchorStatus !== legacyStatus) {
        await this.prisma.driveAnnotationThread.update({ where: { id: thread.id }, data: { anchorStatus: legacyStatus } })
      }
      return { ...thread, anchorStatus: legacyStatus, anchor }
    }))
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

  private async requireCommentThread(itemId: string, commentId: string) {
    const comment = await this.requireComment(itemId, commentId)
    const thread = await this.requireThread(itemId, comment.threadId)
    return { comment, thread }
  }

  private async deleteCommentTree(comment: Pick<AnnotationCommentRecord, "id">, thread: AnnotationThreadRecord) {
    const deletedAt = new Date()
    const threadDeleted = thread.comments[0]?.id === comment.id
    const commentIds = commentSubtreeIds(comment.id, thread.comments)
    if (threadDeleted) {
      await this.prisma.$transaction([
        this.prisma.driveAnnotationComment.updateMany({
          where: { threadId: thread.id, deletedAt: null },
          data: { deletedAt },
        }),
        this.prisma.driveAnnotationThread.update({ where: { id: thread.id }, data: { deletedAt } }),
      ])
    } else {
      await this.prisma.driveAnnotationComment.updateMany({
        where: { id: { in: commentIds }, deletedAt: null },
        data: { deletedAt },
      })
    }
    return {
      deletedCommentCount: thread.comments.filter((item) => (
        !item.deletedAt && (threadDeleted || commentIds.includes(item.id))
      )).length,
      threadDeleted,
    }
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
    targetKind: record.targetKind === "image" ? "image" : "textRange",
    target: record.target as DriveAnnotationTargetDto,
    anchorStatus: record.anchor?.positionStatus === "attached"
      ? "attached"
      : record.anchor
        ? "orphaned"
        : record.anchorStatus === "shifted" || record.anchorStatus === "orphaned" ? record.anchorStatus : "attached",
    anchor: toAnchorDto(record),
    author: toAuthorDto(record.createdByUser, redactAuthorEmail),
    comments: comments.map((comment) => toCommentDto(comment, actorUserId, fileOwnerUserId, canWrite, redactAuthorEmail)),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: { canDelete: canDeleteThread(record, comments, actorUserId, fileOwnerUserId, canWrite) },
  }
}

function toAnchorDto(record: AnnotationThreadRecord): DriveAnnotationAnchorDto | null {
  const selectors = parseAnchorSelectors(record.anchor?.selectors) ?? toDriveAnnotationSelectorsV2(record.target as DriveAnnotationTargetDto)
  const anchor = record.anchor
  if (!anchor) {
    return {
      schemaVersion: 2,
      baseVersionId: record.baseVersionId,
      selectors,
      positionStatus: record.anchorStatus === "orphaned" ? "orphaned" : "attached",
      quoteStatus: "exact",
      resolvedSourceRange: null,
      resolvedRenderedRange: record.anchorStatus === "orphaned" || selectors.kind === "image"
        ? null
        : selectors.renderedPosition ?? null,
      confidence: null,
      lastResolvedVersionId: null,
    }
  }
  return {
    schemaVersion: 2,
    baseVersionId: anchor.baseVersionId,
    selectors,
    positionStatus: normalizePositionStatus(anchor.positionStatus),
    quoteStatus: normalizeQuoteStatus(anchor.quoteStatus),
    resolvedSourceRange: anchor.resolvedSourceStart === null || anchor.resolvedSourceEnd === null
      ? null
      : { start: anchor.resolvedSourceStart, end: anchor.resolvedSourceEnd },
    resolvedRenderedRange: anchor.resolvedRenderedStart === null || anchor.resolvedRenderedEnd === null
      ? null
      : { start: anchor.resolvedRenderedStart, end: anchor.resolvedRenderedEnd },
    confidence: anchor.confidence,
    lastResolvedVersionId: anchor.lastResolvedVersionId,
  }
}

function buildAnchorCreateData(
  itemId: string,
  baseVersionId: string | null,
  selectors: DriveAnnotationSelectorsV2,
  resolution: {
    readonly positionStatus: string
    readonly quoteStatus: string
    readonly sourceRange: { readonly start: number; readonly end: number } | null
    readonly renderedRange: { readonly start: number; readonly end: number } | null
    readonly confidence: number
  },
  idempotencyKey?: string,
) {
  return {
    itemId,
    schemaVersion: 2,
    baseVersionId,
    selectors: selectors as unknown as Prisma.InputJsonValue,
    positionStatus: resolution.positionStatus,
    quoteStatus: resolution.quoteStatus,
    lastResolvedVersionId: baseVersionId,
    resolvedSourceStart: resolution.sourceRange?.start ?? null,
    resolvedSourceEnd: resolution.sourceRange?.end ?? null,
    resolvedRenderedStart: resolution.renderedRange?.start ?? null,
    resolvedRenderedEnd: resolution.renderedRange?.end ?? null,
    confidence: resolution.confidence,
    idempotencyKey: idempotencyKey ?? null,
  }
}

function parseAnchorSelectors(value: unknown): DriveAnnotationSelectorsV2 | null {
  if (!value || typeof value !== "object") return null
  const selectors = value as Partial<DriveAnnotationSelectorsV2>
  if (selectors.schemaVersion !== 2 || !selectors.position) return null
  if (selectors.kind === "image") {
    if (!selectors.semantic || !("imageIndex" in selectors.semantic) || !selectors.identity) return null
  } else if (!("quote" in selectors) || !selectors.quote) {
    return null
  }
  return selectors as DriveAnnotationSelectorsV2
}

function normalizePositionStatus(value: string): DriveAnnotationAnchorDto["positionStatus"] {
  if (value === "source_deleted" || value === "ambiguous" || value === "orphaned" || value === "unavailable") return value
  return "attached"
}

function normalizeQuoteStatus(value: string): DriveAnnotationAnchorDto["quoteStatus"] {
  if (value === "modified" || value === "deleted") return value
  return "exact"
}

function unavailableAnchorRecord(thread: AnnotationThreadRecord): AnnotationAnchorRecord {
  const selectors = parseAnchorSelectors(thread.anchor?.selectors) ?? toDriveAnnotationSelectorsV2(thread.target as DriveAnnotationTargetDto)
  return {
    schemaVersion: 2,
    baseVersionId: thread.baseVersionId,
    selectors,
    positionStatus: "unavailable",
    quoteStatus: thread.anchor?.quoteStatus ?? (selectors.kind === "image" ? "deleted" : "exact"),
    lastResolvedVersionId: thread.anchor?.lastResolvedVersionId ?? null,
    resolvedSourceStart: null,
    resolvedSourceEnd: null,
    resolvedRenderedStart: null,
    resolvedRenderedEnd: null,
    confidence: 0,
  }
}

function hasGraphemeBoundaries(value: string, range: { readonly start: number; readonly end: number }): boolean {
  if (typeof Intl.Segmenter !== "function") return true
  const points = Array.from(value)
  if (range.start < 0 || range.end > points.length || range.end <= range.start) return false
  const utf16Start = points.slice(0, range.start).join("").length
  const utf16End = points.slice(0, range.end).join("").length
  const boundaries = new Set<number>([0, value.length])
  for (const segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) {
    boundaries.add(segment.index)
  }
  return boundaries.has(utf16Start) && boundaries.has(utf16End)
}

function staleAnnotationConflict(): ConflictException {
  return new ConflictException({ code: "DRIVE_ANNOTATION_STALE", message: "评论位置已失效，请重新选择。" })
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
  if (comments[0]?.deletedAt) return []
  const byId = new Map(comments.map((comment) => [comment.id, comment]))
  return comments.filter((comment) => {
    if (comment.deletedAt) return false
    let parentCommentId = comment.parentCommentId
    const visited = new Set<string>()
    while (parentCommentId && !visited.has(parentCommentId)) {
      visited.add(parentCommentId)
      const parent = byId.get(parentCommentId)
      if (!parent) break
      if (parent.deletedAt) return false
      parentCommentId = parent.parentCommentId
    }
    return true
  })
}

function commentSubtreeIds(commentId: string, comments: readonly AnnotationCommentRecord[]): string[] {
  const childrenByParentId = new Map<string, string[]>()
  for (const comment of comments) {
    if (!comment.parentCommentId) continue
    const children = childrenByParentId.get(comment.parentCommentId) ?? []
    children.push(comment.id)
    childrenByParentId.set(comment.parentCommentId, children)
  }
  const subtreeIds = new Set<string>()
  const pending = [commentId]
  while (pending.length > 0) {
    const currentId = pending.pop()
    if (!currentId || subtreeIds.has(currentId)) continue
    subtreeIds.add(currentId)
    pending.push(...(childrenByParentId.get(currentId) ?? []))
  }
  return comments.filter((comment) => subtreeIds.has(comment.id)).map((comment) => comment.id)
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
    handle: record.handle,
  }
}

function codePointRangeToUtf16(
  value: string,
  range: { readonly start: number; readonly end: number },
): { readonly start: number; readonly end: number } {
  const codePoints = Array.from(value)
  return {
    start: codePoints.slice(0, range.start).join("").length,
    end: codePoints.slice(0, range.end).join("").length,
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
