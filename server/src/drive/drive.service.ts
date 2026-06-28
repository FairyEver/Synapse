import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, Optional, PayloadTooLargeException, UnauthorizedException } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import {
  type DriveBrowserAnnotationCapabilityDto,
  type DriveBrowserChildrenPageDto,
  type DriveBrowserSnapshotDto,
  buildDriveShareUrl,
  buildDriveUrlWithPassword,
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  DRIVE_MAX_FILE_SIZE_LABEL,
  type DriveAccessSettingsInput,
  type DriveFolderPathEnsureInput,
  type DriveFolderPathEnsureResultDto,
  type DriveFolderUploadPrepareResult,
  type DriveFileVersionDto,
  type DriveFileVersionListInput,
  type DriveFileVersionListPageDto,
  type DriveFileContentUpdateResult,
  type DriveFileTextUpdateInput,
  type DriveItemDto,
  type DriveItemTreeEntryDto,
  type DriveItemTreeListInput,
  type DriveItemTreeListPageDto,
  type DriveReorganizationApplyInput,
  type DriveReorganizationApplyResultDto,
  type DriveReorganizationAppliedMoveDto,
  type DriveReorganizationPlannedMoveDto,
  type DriveReorganizationPreviewDto,
  type DriveReorganizationPreviewInput,
  type DriveStatsDto,
  type DriveShareDto,
  type DriveShareListPageDto,
  type DriveShareListItemDto,
  type DriveShareAccessMode,
  type DriveTrashListPageDto,
  type DriveUploadPrepareResult,
  type DriveUsageDto,
} from "@synapse/shared"
import { AuditLogService } from "../common/audit-log.service"
import { formatAuditError } from "../common/audit-error"
import { toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"
import {
  buildDriveAccessCookie,
  createDrivePasswordMaterial,
  decryptDrivePassword,
  verifyDriveAccessCookie,
  verifyDrivePasswordInput,
  type DrivePasswordMaterial,
} from "./drive-access-protection"
import { renderDriveMarkdownFragment } from "./drive-markdown-renderer"
import {
  createDriveFileVersion,
  createDriveFileVersionId,
  DRIVE_FILE_VERSION_SOURCE,
  driveVersionStorageKey,
  ensureCurrentDriveFileVersion,
  listCleanupCandidateVersions,
  toDriveFileVersionDto,
} from "./drive-version-history"
import {
  DRIVE_ITEM_LIFECYCLE_STATUS,
  DRIVE_ITEM_TYPE,
  DRIVE_STORAGE_STATUS,
  DRIVE_UPLOAD_PURPOSE,
  DRIVE_UPLOAD_STATUS,
  driveMaxFileBytes,
  driveUploadUrlTtlSeconds,
} from "./drive.constants"
import { DriveLifecycleService } from "./drive-lifecycle.service"
import { ensureDriveUsage, reserveDriveUsageBytes } from "./drive-usage"
import {
  createDriveShareId,
  driveOverwriteStorageKeyForSession,
  driveStorageKeyForItem,
  isValidDriveItemName,
} from "./drive-token"
import type { DriveStoragePort } from "./drive-storage"
import {
  buildConsoleDriveRootBreadcrumb,
  buildConsoleDriveRootItemDto,
  buildDriveBrowserBreadcrumb,
  buildDriveBrowserItemDto,
  buildDriveBrowserPreview,
  DRIVE_BROWSER_TEXT_PREVIEW_MAX_BYTES,
  resolveDriveBrowserPreviewKind,
  shouldCreateDriveBrowserImagePreview,
  shouldReadDriveBrowserTextPreview,
  type DriveBrowserRouteContext,
  type DriveBrowserSourceItem,
} from "./drive-browser"
import { isCommentableMarkdownItem } from "./drive-annotation-target"
import { DriveChangeLogService, type DriveChangeAppendInput } from "./drive-change-log"
import { buildDriveBrowserEdit, DRIVE_INLINE_TEXT_EDIT_MAX_BYTES, isDriveTextEditablePreviewKind } from "./drive-editable-preview"
import {
  canUserEditShare,
  DRIVE_SHARE_ACCESS_MODE,
  normalizeDriveAccessSettings,
  normalizeDriveShareAccessMode,
  normalizeDriveShareEditorEmail,
} from "./drive-share-access"
import {
  toDriveItemDto,
  type DriveAdminFilters,
  type DriveAdminItemDto,
  type DriveAdminStorageSummaryDto,
  type DriveItemRecord,
  type DrivePrepareFolderUploadInput,
  type DrivePrepareUploadInput,
} from "./drive.types"

type DrivePrismaClient = PrismaService | Prisma.TransactionClient

type DriveReorganizationPlan = {
  readonly userId: string
  readonly planId: string
  readonly expiresAt: Date
  readonly moves: readonly DriveReorganizationPlannedMoveDto[]
  readonly skipped: readonly { readonly itemId: string; readonly reason: string }[]
}

type DriveReorganizationTargetMove = Pick<DriveReorganizationPlannedMoveDto, "itemId" | "name" | "targetParentId"> & {
  readonly type: string
}

type DrivePublicAccessResult<T> =
  | { readonly status: "ok"; readonly value: T; readonly cookie?: string }
  | { readonly status: "password_required" }

type DrivePublicShareValue = {
  readonly id: string
  readonly shareId: string
  readonly item: DriveItemDto
  readonly ownerId: string
  readonly storageKey: string | null
  readonly type: "file" | "folder"
  readonly accessMode: DriveShareAccessMode
  readonly editorEmails: readonly string[]
}

type DriveRenderedAssetValue = {
  readonly stream: NodeJS.ReadableStream
  readonly contentType: string
  readonly size?: bigint
  readonly csp?: string
}

type DriveFolderZipEntry = {
  readonly path: string
  readonly storageKey: string
}

type DriveFolderZipBrowserResult = {
  readonly filename: string
  readonly entries: AsyncIterable<DriveFolderZipEntry>
}

type DriveBrowserDownloadResult = {
  readonly stream: NodeJS.ReadableStream
  readonly fileName: string
  readonly size?: bigint
  readonly contentType?: string | null
}

type DriveBrowserTransferResult =
  | ({ readonly kind: "file" } & DriveBrowserDownloadResult)
  | ({ readonly kind: "zip" } & DriveFolderZipBrowserResult)

type DriveBrowserChildrenPageInput = {
  readonly offset?: number
  readonly limit?: number
}

type DrivePublicLinksPageInput = {
  readonly offset?: number
  readonly limit?: number
  readonly search?: string
}

type DriveBrowserChildrenResult = {
  readonly items: readonly DriveItemRecordWithStorage[]
  readonly page: DriveBrowserChildrenPageDto
}

type DriveItemRecordWithStorage = DriveItemRecord & {
  readonly userId: string
  readonly storageKey: string | null
}

type DriveAuditContext = {
  readonly ipAddress?: string
}

const driveItemWithShares = {
  shares: {
    where: { enabled: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      enabled: true,
      passwordEnabled: true,
      expiresAt: true,
      accessMode: true,
      editors: {
        select: { email: true },
        orderBy: { email: "asc" },
      },
    },
  },
} as const

const driveShareWithEditors = {
  editors: {
    select: { email: true },
    orderBy: { email: "asc" },
  },
} as const

const DRIVE_BROWSER_CHILDREN_DEFAULT_LIMIT = 100
const DRIVE_BROWSER_CHILDREN_MAX_LIMIT = 200
const DRIVE_ITEM_TREE_DEFAULT_LIMIT = 500
const DRIVE_ITEM_TREE_MAX_LIMIT = 2000
const DRIVE_REORGANIZATION_PLAN_TTL_MS = 5 * 60 * 1000
const DRIVE_REORGANIZATION_AUDIT_MOVE_LIMIT = 100

type DriveItemTreeQueryRow = {
  readonly id: string | null
  readonly parentId: string | null
  readonly type: string | null
  readonly name: string | null
  readonly size: bigint | null
  readonly mimeType: string | null
  readonly storageStatus: string | null
  readonly createdAt: Date | null
  readonly updatedAt: Date | null
  readonly path: string | null
  readonly depth: number | null
  readonly activeShareId: string | null
  readonly total: bigint | number
  readonly fileCount: bigint | number
  readonly folderCount: bigint | number
}

type DriveItemTreeEntryQueryRow = DriveItemTreeQueryRow & {
  readonly id: string
  readonly type: string
  readonly name: string
  readonly size: bigint
  readonly storageStatus: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly path: string
  readonly depth: number
}

@Injectable()
export class DriveService implements OnApplicationBootstrap {
  private readonly accessSecret = readUserAccessJwtSecret(process.env)
  private readonly logger = new Logger(DriveService.name)
  private readonly reorganizationPlans = new Map<string, DriveReorganizationPlan>()

  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly lifecycle?: DriveLifecycleService,
    @Optional() private readonly changes?: DriveChangeLogService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.backfillLegacyDriveAccessProtection()
  }

  async listItems(userId: string, parentId: string | null): Promise<DriveItemDto[]> {
    if (parentId) await this.requireOwnedFolder(userId, parentId)
    const items = await this.prisma.driveItem.findMany({
      where: ordinaryDriveItemWhere({ userId, parentId }),
      include: driveItemWithShares,
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    })
    return items.map(toDriveItemDto)
  }

  async getItem(userId: string, itemId: string): Promise<DriveItemDto> {
    return toDriveItemDto(await this.requireOwnedItem(userId, itemId))
  }

  async listFileVersions(userId: string, itemId: string, input: DriveFileVersionListInput = {}): Promise<DriveFileVersionListPageDto> {
    const item = await this.requireOwnedFile(userId, itemId)
    const page = normalizeDrivePublicLinksPage(input)
    const [versions, total] = await this.prisma.$transaction([
      this.prisma.driveFileVersion.findMany({
        where: { itemId: item.id, userId, deletedAt: null },
        orderBy: { versionNumber: "desc" },
        skip: page.offset,
        take: page.limit + 1,
      }),
      this.prisma.driveFileVersion.count({
        where: { itemId: item.id, userId, deletedAt: null },
      }),
    ])
    return {
      items: versions.slice(0, page.limit).map((version) => toDriveFileVersionDto(version, item.storageKey)),
      total,
      page: buildDrivePublicLinksPage(page, versions.length),
    }
  }

  async restoreFileVersion(userId: string, itemId: string, versionId: string, auditContext: DriveAuditContext = {}): Promise<DriveItemDto> {
    const item = await this.requireOwnedFile(userId, itemId)
    const version = await this.requireOwnedFileVersion(userId, item.id, versionId)
    if (item.storageKey === version.storageKey) throw new BadRequestException("不能恢复当前版本。")
    const usage = await ensureUsage(this.prisma, userId)
    if (usage.usedBytes + usage.reservedBytes + version.size > usage.quotaBytes) {
      throw new BadRequestException("云盘空间不足。")
    }
    const nextVersionId = createDriveFileVersionId()
    const nextStorageKey = driveVersionStorageKey(item.id, nextVersionId)
    let copied = false
    let committed = false
    try {
      await this.storage.copyObject({
        fromKey: version.storageKey,
        toKey: nextStorageKey,
        contentType: version.mimeType,
      })
      copied = true
      const restored = await this.prisma.$transaction(async (tx) => {
        await createDriveFileVersion(tx, {
          id: nextVersionId,
          itemId: item.id,
          userId,
          storageKey: nextStorageKey,
          size: version.size,
          mimeType: version.mimeType,
          source: DRIVE_FILE_VERSION_SOURCE.restore,
          etag: version.etag,
          restoredFromVersionId: version.id,
          createdBy: userId,
        })
        await updateDriveUsageAfterUploadCompletion(tx, userId, {
          reservedBytes: 0n,
          usedBytesDelta: version.size,
        })
        const restored = await tx.driveItem.update({
          where: { id: item.id },
          data: {
            storageKey: nextStorageKey,
            size: version.size,
            mimeType: version.mimeType,
            storageStatus: DRIVE_STORAGE_STATUS.active,
            uploadStatus: DRIVE_UPLOAD_STATUS.completed,
          },
          include: driveItemWithShares,
        })
        await this.recordDriveChange({
          userId,
          itemId: restored.id,
          parentId: restored.parentId,
          type: "content_updated",
          versionId: nextVersionId,
          etag: version.etag,
          name: restored.name,
          actor: userId,
        }, tx)
        return restored
      })
      committed = true
      await this.recordDriveAudit({
        userId,
        action: "drive.file_version.restore",
        targetType: "drive.fileVersion",
        targetId: version.id,
        detail: { userId, itemId: item.id, versionId: version.id, restoredItemId: restored.id },
        ipAddress: auditContext.ipAddress,
      })
      await this.cleanupFileVersionsAfterChange(userId, restored.id)
      return toDriveItemDto(restored)
    } catch (error) {
      if (copied && !committed) await this.deleteTemporaryUploadObject(nextStorageKey)
      throw error
    }
  }

  async updateOwnerFileText(
    userId: string,
    itemId: string,
    input: DriveFileTextUpdateInput,
    auditContext: DriveAuditContext = {},
  ): Promise<DriveFileContentUpdateResult> {
    const item = await this.requireOwnedFile(userId, itemId) as DriveItemRecordWithStorage
    this.assertActiveBrowserItem(item)
    return this.commitTextFileChange({
      ownerId: userId,
      actorUserId: userId,
      item,
      input,
      auditContext,
      auditAction: "drive.file.edit",
    })
  }

  async updateShareFileText(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string | null
    readonly password?: string
    readonly cookie?: string
    readonly accessCookie?: string
    readonly body: DriveFileTextUpdateInput
    readonly auditContext?: DriveAuditContext
  }): Promise<DriveFileContentUpdateResult> {
    const access = await this.resolvePublicShareAccess({
      shareId: input.shareId,
      password: input.password,
      cookie: input.cookie ?? input.accessCookie,
    })
    if (access.status !== "ok") throw new UnauthorizedException("需要先解锁分享。")
    const share = access.value
    const { current } = await this.resolveShareBrowserCurrent(share, input.itemId)
    if (current.type !== DRIVE_ITEM_TYPE.file) throw new BadRequestException("目标不是文件。")
    const actor = await this.prisma.user.findUnique({
      where: { id: input.actorUserId },
      select: { email: true },
    })
    if (!actor) throw new UnauthorizedException("未登录或登录已过期。")
    if (!canUserEditShare({
      accessMode: share.accessMode,
      actorUserId: input.actorUserId,
      actorEmail: actor.email,
      ownerId: share.ownerId,
      editorEmails: share.editorEmails,
    })) {
      throw new ForbiddenException("没有编辑权限。")
    }
    return this.commitTextFileChange({
      ownerId: share.ownerId,
      actorUserId: input.actorUserId,
      item: current,
      input: input.body,
      auditContext: input.auditContext ?? {},
      auditAction: "drive.share_file.edit",
      shareRecordId: share.id,
      shareId: share.shareId,
    })
  }

  async getOwnerMarkdownImageDocument(input: {
    readonly actorUserId: string
    readonly itemId: string
  }): Promise<{ readonly itemId: string; readonly ownerId: string; readonly versionId: string | null; readonly markdown: string }> {
    const item = await this.requireOwnedItem(input.actorUserId, input.itemId) as DriveItemRecordWithStorage
    this.assertActiveBrowserItem(item)
    this.assertEditableTextFile(item)
    const storageKey = this.requireActiveFileStorage(item)
    const preview = await this.readTextPreview(storageKey)
    return {
      itemId: item.id,
      ownerId: item.userId,
      versionId: await this.findCurrentDriveFileVersionId(item),
      markdown: preview.text,
    }
  }

  async getShareMarkdownImageDocument(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string | null
    readonly cookie?: string
    readonly accessCookie?: string
  }): Promise<{ readonly itemId: string; readonly ownerId: string; readonly versionId: string | null; readonly markdown: string }> {
    const access = await this.resolvePublicShareAccess({
      shareId: input.shareId,
      cookie: input.cookie ?? input.accessCookie,
    })
    if (access.status !== "ok") throw new UnauthorizedException("需要先解锁分享。")

    const { current } = await this.resolveShareBrowserCurrent(access.value, input.itemId)
    this.assertActiveBrowserItem(current)
    this.assertEditableTextFile(current)
    const storageKey = this.requireActiveFileStorage(current)
    const preview = await this.readTextPreview(storageKey)
    return {
      itemId: current.id,
      ownerId: access.value.ownerId,
      versionId: await this.findCurrentDriveFileVersionId(current),
      markdown: preview.text,
    }
  }

  async findPublicAssetOwner(assetId: string): Promise<string | null> {
    const asset = await this.prisma.publicAsset.findFirst({
      where: {
        assetId,
        deletedAt: null,
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
      },
      select: { userId: true },
    })
    return asset?.userId ?? null
  }

  async deleteFileVersion(userId: string, itemId: string, versionId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const item = await this.requireOwnedFile(userId, itemId)
    const version = await this.requireOwnedFileVersion(userId, item.id, versionId)
    if (item.storageKey === version.storageKey) throw new BadRequestException("不能删除当前版本。")
    const deleted = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.driveFileVersion.updateMany({
        where: { id: version.id, itemId: item.id, userId, deletedAt: null },
        data: { deletedAt: new Date(), deletePending: false },
      })
      if (updated.count === 0) return false
      await tx.driveUsage.update({
        where: { userId },
        data: { usedBytes: { decrement: version.size } },
      })
      return true
    })
    if (!deleted) return { ok: true }
    try {
      await this.storage.deleteObject(version.storageKey)
    } catch (error) {
      await this.prisma.driveFileVersion.update({
        where: { id: version.id },
        data: { deletePending: true },
      })
      this.logger.warn({
        itemId: item.id,
        versionId: version.id,
        storageKeyLength: version.storageKey.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Drive file version object delete failed")
    }
    await this.recordDriveAudit({
      userId,
      action: "drive.file_version.delete",
      targetType: "drive.fileVersion",
      targetId: version.id,
      detail: { userId, itemId: item.id, versionId: version.id, size: version.size.toString() },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true }
  }

  async updateFileVersionPin(userId: string, itemId: string, versionId: string, isPinned: boolean, auditContext: DriveAuditContext = {}): Promise<DriveFileVersionDto> {
    const item = await this.requireOwnedFile(userId, itemId)
    await this.requireOwnedFileVersion(userId, item.id, versionId)
    const version = await this.prisma.driveFileVersion.update({
      where: { id: versionId },
      data: { isPinned },
    })
    await this.recordDriveAudit({
      userId,
      action: "drive.file_version.pin_update",
      targetType: "drive.fileVersion",
      targetId: version.id,
      detail: { userId, itemId: item.id, versionId: version.id, isPinned },
      ipAddress: auditContext.ipAddress,
    })
    return toDriveFileVersionDto(version, item.storageKey)
  }

  async openFileVersionDownload(userId: string, itemId: string, versionId: string): Promise<DriveBrowserDownloadResult> {
    const item = await this.requireOwnedFile(userId, itemId)
    const version = await this.requireOwnedFileVersion(userId, item.id, versionId)
    const object = await this.storage.getObjectStream({ key: version.storageKey })
    return {
      stream: object.stream,
      fileName: versionFileName(item.name, version.versionNumber),
      size: object.size ?? version.size,
      contentType: object.contentType ?? version.mimeType,
    }
  }

  async retryPendingFileVersionDeletes(limit = 100): Promise<{ readonly attempted: number; readonly deleted: number; readonly failed: number }> {
    const versions = await this.prisma.driveFileVersion.findMany({
      where: { deletePending: true, deletedAt: { not: null } },
      orderBy: { createdAt: "asc" },
      take: Math.max(1, Math.min(Math.floor(limit), 500)),
    })
    let deleted = 0
    let failed = 0
    for (const version of versions) {
      try {
        await this.storage.deleteObject(version.storageKey)
        await this.prisma.driveFileVersion.update({
          where: { id: version.id },
          data: { deletePending: false },
        })
        deleted += 1
      } catch (error) {
        failed += 1
        this.logger.warn({
          versionId: version.id,
          storageKeyLength: version.storageKey.length,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: formatAuditError(error),
        }, "Drive file version pending delete retry failed")
      }
    }
    return { attempted: versions.length, deleted, failed }
  }

  async retryPendingDriveItemStorageDeletes(limit = 100): Promise<{ readonly attempted: number; readonly deleted: number; readonly failed: number }> {
    const items = await this.prisma.driveItem.findMany({
      where: {
        storageDeletePending: true,
        storageStatus: DRIVE_STORAGE_STATUS.deletePending,
        deletedAt: { not: null },
        storageKey: { not: null },
      },
      orderBy: { updatedAt: "asc" },
      take: Math.max(1, Math.min(Math.floor(limit), 500)),
    })
    let deleted = 0
    let failed = 0
    for (const item of items) {
      try {
        await this.storage.deleteObject(item.storageKey!)
        await this.prisma.driveItem.update({
          where: { id: item.id },
          data: {
            storageDeletePending: false,
            storageStatus: DRIVE_STORAGE_STATUS.deleted,
          },
        })
        deleted += 1
      } catch (error) {
        failed += 1
        this.logger.warn({
          itemId: item.id,
          storageKeyLength: item.storageKey?.length ?? 0,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: formatAuditError(error),
        }, "Drive item pending storage delete retry failed")
      }
    }
    return { attempted: items.length, deleted, failed }
  }

  async prepareUpload(userId: string, input: DrivePrepareUploadInput): Promise<DriveUploadPrepareResult> {
    const name = normalizeDriveName(input.name)
    const requestedSize = parseRequestedSize(input.size)
    if (requestedSize > driveMaxFileBytes) throw new BadRequestException(`文件超过 ${DRIVE_MAX_FILE_SIZE_LABEL} 限制。`)
    if (input.parentId) await this.requireOwnedFolder(userId, input.parentId)

    const result = await this.prisma.$transaction(async (tx) => {
      const existingFile = await tx.driveItem.findFirst({
        where: {
          userId,
          parentId: input.parentId,
          type: DRIVE_ITEM_TYPE.file,
          name,
          storageStatus: DRIVE_STORAGE_STATUS.active,
          deletedAt: null,
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
          publicAsset: null,
        },
        include: driveItemWithShares,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
      const reservedBytes = requestedSize
      if (existingFile) {
        const sessionId = randomUUID()
        const storageKey = driveOverwriteStorageKeyForSession(existingFile.id, sessionId)
        const session = await tx.driveUploadSession.create({
          data: {
            id: sessionId,
            userId,
            itemId: existingFile.id,
            storageKey,
            expectedName: name,
            expectedSize: requestedSize,
            expectedMime: input.mimeType ?? null,
            reservedBytes,
            status: DRIVE_UPLOAD_STATUS.pending,
            credentialKind: "presigned_put",
            expiresAt: new Date(Date.now() + driveUploadUrlTtlSeconds * 1000),
          },
        })
        await reserveDriveUsageBytes(tx, userId, reservedBytes)
        return { item: existingFile, session }
      }
      const item = await tx.driveItem.create({
        data: {
          userId,
          parentId: input.parentId,
          type: DRIVE_ITEM_TYPE.file,
          name,
          size: requestedSize,
          mimeType: input.mimeType ?? null,
          storageStatus: DRIVE_STORAGE_STATUS.pending,
          uploadStatus: DRIVE_UPLOAD_STATUS.pending,
        },
      })
      const storageKey = driveStorageKeyForItem(item.id)
      const updatedItem = await tx.driveItem.update({
        where: { id: item.id },
        data: { storageKey },
        include: driveItemWithShares,
      })
      const session = await tx.driveUploadSession.create({
        data: {
          userId,
          itemId: item.id,
          storageKey,
          expectedName: name,
          expectedSize: requestedSize,
          expectedMime: input.mimeType ?? null,
          reservedBytes: requestedSize,
          status: DRIVE_UPLOAD_STATUS.pending,
          credentialKind: "presigned_put",
          expiresAt: new Date(Date.now() + driveUploadUrlTtlSeconds * 1000),
        },
      })
      await reserveDriveUsageBytes(tx, userId, requestedSize)
      return { item: updatedItem, session }
    })

    let upload: Awaited<ReturnType<DriveStoragePort["createUploadInstruction"]>>
    try {
      upload = await this.storage.createUploadInstruction({
        key: result.session.storageKey,
        contentType: input.mimeType ?? undefined,
        expectedSize: result.session.expectedSize,
      })
    } catch (error) {
      await this.failUploadSession(userId, result.session.id, result.session.itemId, result.session.reservedBytes, DRIVE_UPLOAD_STATUS.failed, new Date(), result.session.storageKey)
      throw error
    }
    return {
      sessionId: result.session.id,
      item: toDriveItemDto(result.item),
      upload: {
        method: upload.method,
        url: upload.url,
        expiresAt: upload.expiresAt.toISOString(),
        headers: upload.headers,
      },
    }
  }

  async prepareFolderUpload(userId: string, input: DrivePrepareFolderUploadInput, auditContext: DriveAuditContext = {}): Promise<DriveFolderUploadPrepareResult> {
    if (input.files.length === 0) throw new BadRequestException("文件夹不能为空。")
    const plannedFiles = input.files.map((file) => {
      const parts = normalizeRelativePath(file.relativePath)
      const relativePath = parts.join("/")
      return { file, parts, relativePath }
    })
    const seenRelativePaths = new Set<string>()
    for (const planned of plannedFiles) {
      if (seenRelativePaths.has(planned.relativePath)) throw new BadRequestException("文件路径重复。")
      seenRelativePaths.add(planned.relativePath)
    }
    let root: DriveItemDto | null = null
    let preservedItemIds = new Set<string>()
    const preparedSessionIds: string[] = []
    const entries: DriveFolderUploadPrepareResult["entries"] = []

    try {
      const rootResult = await this.ensureFolderForUpload(userId, { parentId: input.parentId, name: input.folderName }, auditContext)
      root = rootResult.folder
      preservedItemIds = rootResult.created
        ? new Set<string>()
        : new Set(await this.listDriveSubtreeItemIds(this.prisma, userId, root.id))
      const folderIdsByPath = new Map<string, string>([["", root.id]])

      for (const planned of plannedFiles) {
        const { file, parts, relativePath } = planned
        const fileName = parts.at(-1)
        if (!fileName) throw new BadRequestException("文件路径无效。")
        const folderParts = parts.slice(0, -1)
        let parentId = root.id
        let currentPath = ""
        for (const folderName of folderParts) {
          currentPath = currentPath ? `${currentPath}/${folderName}` : folderName
          const existingId = folderIdsByPath.get(currentPath)
          if (existingId) {
            parentId = existingId
            continue
          }
          const folderResult = await this.ensureFolderForUpload(userId, { parentId, name: folderName }, auditContext)
          const folder = folderResult.folder
          folderIdsByPath.set(currentPath, folder.id)
          parentId = folder.id
        }
        const prepared = await this.prepareUpload(userId, {
          parentId,
          name: fileName,
          size: file.size,
          mimeType: file.mimeType ?? null,
          publicAppUrl: input.publicAppUrl,
        })
        preparedSessionIds.push(prepared.sessionId)
        entries.push({ relativePath, ...prepared })
      }

      return { root, rootCreated: rootResult.created, entries }
    } catch (error) {
      if (root) await this.rollbackFolderUploadPrepare(userId, root.id, preservedItemIds, preparedSessionIds)
      throw error
    }
  }

  async completeUpload(userId: string, sessionId: string, auditContext: DriveAuditContext = {}): Promise<DriveItemDto> {
    const session = await this.prisma.driveUploadSession.findFirst({
      where: { id: sessionId, userId },
      include: { item: { include: driveItemWithShares } },
    })
    if (!session || session.item.deletedAt || session.item.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active) throw new NotFoundException("上传会话不存在。")
    if (session.status === DRIVE_UPLOAD_STATUS.completed) {
      return toDriveItemDto(session.item)
    }
    if (session.status !== DRIVE_UPLOAD_STATUS.pending) throw new NotFoundException("上传会话不存在。")
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.failUploadSession(userId, session.id, session.itemId, session.reservedBytes, DRIVE_UPLOAD_STATUS.expired, new Date(), session.storageKey)
      throw new BadRequestException("上传会话已过期。")
    }
    const object = await this.storage.headObject(session.storageKey)
    if (!object || object.size !== session.expectedSize) {
      await this.failUploadSession(userId, session.id, session.itemId, session.reservedBytes, DRIVE_UPLOAD_STATUS.failed, new Date(), session.storageKey)
      throw new BadRequestException("上传文件校验失败。")
    }

    const versionId = createDriveFileVersionId()
    const versionStorageKey = driveVersionStorageKey(session.itemId, versionId)
    try {
      await this.storage.copyObject({
        fromKey: session.storageKey,
        toKey: versionStorageKey,
        contentType: session.expectedMime ?? null,
      })
    } catch (error) {
      await this.failUploadSession(userId, session.id, session.itemId, session.reservedBytes, DRIVE_UPLOAD_STATUS.failed, new Date(), session.storageKey)
      throw error
    }

    let committed = false
    const result = await this.prisma.$transaction(async (tx) => {
      const isOverwrite = isOverwriteUploadSession(session)
      const transitioned = await tx.driveUploadSession.updateMany({
        where: { id: session.id, userId, status: DRIVE_UPLOAD_STATUS.pending },
        data: { status: DRIVE_UPLOAD_STATUS.completed, completedAt: new Date() },
      })
      if (transitioned.count === 0) {
        const current = await tx.driveUploadSession.findFirst({
          where: { id: session.id, userId, status: DRIVE_UPLOAD_STATUS.completed },
          include: { item: { include: driveItemWithShares } },
        })
        if (!current || current.item.deletedAt || current.item.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active) throw new NotFoundException("上传会话不存在。")
        const item = current.item.storageStatus === DRIVE_STORAGE_STATUS.active && current.item.uploadStatus === DRIVE_UPLOAD_STATUS.completed
          ? current.item
          : await tx.driveItem.update({
            where: { id: current.itemId },
            data: {
              storageStatus: DRIVE_STORAGE_STATUS.active,
              uploadStatus: DRIVE_UPLOAD_STATUS.completed,
            },
            include: driveItemWithShares,
          })
        return { item, completedNow: false }
      }
      if (isOverwrite) await ensureCurrentDriveFileVersion(tx, { item: session.item })
      await updateDriveUsageAfterUploadCompletion(tx, userId, {
        reservedBytes: session.reservedBytes,
        usedBytesDelta: session.expectedSize,
      })
      await createDriveFileVersion(tx, {
        id: versionId,
        itemId: session.itemId,
        userId,
        storageKey: versionStorageKey,
        size: session.expectedSize,
        mimeType: session.expectedMime ?? null,
        source: DRIVE_FILE_VERSION_SOURCE.upload,
        etag: object.etag ?? null,
        createdBy: userId,
      })
      const item = await tx.driveItem.update({
        where: { id: session.itemId },
        data: {
          storageKey: versionStorageKey,
          size: session.expectedSize,
          mimeType: session.expectedMime ?? null,
          storageStatus: DRIVE_STORAGE_STATUS.active,
          uploadStatus: DRIVE_UPLOAD_STATUS.completed,
        },
        include: driveItemWithShares,
      })
      await this.recordDriveChange({
        userId,
        itemId: item.id,
        parentId: item.parentId,
        type: "content_updated",
        versionId,
        etag: object.etag ?? null,
        name: item.name,
        actor: userId,
      }, tx)
      return { item, completedNow: true }
    }).then((transactionResult) => {
      committed = true
      return transactionResult
    }).catch(async (error) => {
      if (!committed) await this.deleteTemporaryUploadObject(versionStorageKey)
      throw error
    })
    if (!result.completedNow) {
      await this.deleteTemporaryUploadObject(versionStorageKey)
    }
    if (result.completedNow && session.storageKey !== result.item.storageKey) {
      await this.deleteTemporaryUploadObject(session.storageKey)
      await this.cleanupFileVersionsAfterChange(userId, result.item.id)
    }
    if (result.completedNow) {
      await this.recordDriveAudit({
        userId,
        action: "drive.upload.complete",
        targetType: "drive.item",
        targetId: result.item.id,
        detail: { userId, sessionId: session.id, itemId: result.item.id, name: result.item.name, size: result.item.size.toString() },
        ipAddress: auditContext.ipAddress,
      })
    }
    return toDriveItemDto(result.item)
  }

  async cancelUpload(userId: string, sessionId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const session = await this.prisma.driveUploadSession.findFirst({
      where: { id: sessionId, userId, status: DRIVE_UPLOAD_STATUS.pending },
    })
    if (!session) throw new NotFoundException("上传会话不存在。")
    const transitioned = await this.failUploadSession(userId, session.id, session.itemId, session.reservedBytes, DRIVE_UPLOAD_STATUS.cancelled, new Date(), session.storageKey)
    if (!transitioned) throw new NotFoundException("上传会话不存在。")
    await this.recordDriveAudit({
      userId,
      action: "drive.upload.cancel",
      targetType: "drive.uploadSession",
      targetId: session.id,
      detail: { userId, sessionId: session.id, itemId: session.itemId, status: DRIVE_UPLOAD_STATUS.cancelled },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true }
  }

  async createFolder(userId: string, input: { parentId: string | null; name: string }, auditContext: DriveAuditContext = {}): Promise<DriveItemDto> {
    const name = normalizeDriveName(input.name)
    if (input.parentId) await this.requireOwnedFolder(userId, input.parentId)
    const existingFolder = await this.prisma.driveItem.findFirst({
      where: { userId, parentId: input.parentId, name, type: DRIVE_ITEM_TYPE.folder, deletedAt: null, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active },
      select: { id: true },
    })
    if (existingFolder) throw new BadRequestException("同名文件夹已存在。")
    const folder = await this.prisma.$transaction(async (tx) => {
      const created = await tx.driveItem.create({
        data: {
          userId,
          parentId: input.parentId,
          type: DRIVE_ITEM_TYPE.folder,
          name,
          size: 0n,
          storageStatus: DRIVE_STORAGE_STATUS.active,
          uploadStatus: DRIVE_UPLOAD_STATUS.completed,
        },
        include: driveItemWithShares,
      })
      await this.recordDriveChange({
        userId,
        itemId: created.id,
        parentId: created.parentId,
        type: "created",
        name: created.name,
        actor: userId,
      }, tx)
      return created
    })
    await this.recordDriveAudit({
      userId,
      action: "drive.folder.create",
      targetType: "drive.item",
      targetId: folder.id,
      detail: { userId, itemId: folder.id, parentId: folder.parentId, name: folder.name },
      ipAddress: auditContext.ipAddress,
    })
    return toDriveItemDto(folder)
  }

  private async ensureFolderForUpload(
    userId: string,
    input: { parentId: string | null; name: string },
    auditContext: DriveAuditContext = {},
  ): Promise<{ readonly folder: DriveItemDto; readonly created: boolean }> {
    const name = normalizeDriveName(input.name)
    if (input.parentId) await this.requireOwnedFolder(userId, input.parentId)
    const existingFolder = await this.prisma.driveItem.findFirst({
      where: { userId, parentId: input.parentId, name, type: DRIVE_ITEM_TYPE.folder, deletedAt: null, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active },
      include: driveItemWithShares,
    })
    if (existingFolder) return { folder: toDriveItemDto(existingFolder), created: false }
    return { folder: await this.createFolder(userId, { parentId: input.parentId, name }, auditContext), created: true }
  }

  async renameItem(userId: string, itemId: string, name: string, auditContext: DriveAuditContext = {}): Promise<DriveItemDto> {
    const item = await this.requireOwnedItem(userId, itemId)
    const nextName = normalizeDriveName(name)
    await this.assertNoSameTypeNameConflict({
      excludeItemId: item.id,
      message: item.type === DRIVE_ITEM_TYPE.folder ? "同名文件夹已存在。" : "同名文件已存在。",
      name: nextName,
      parentId: item.parentId,
      type: item.type,
      userId,
    })
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.driveItem.update({
        where: { id: itemId },
        data: { name: nextName },
        include: driveItemWithShares,
      })
      await this.recordDriveChange({
        userId,
        itemId: next.id,
        parentId: next.parentId,
        type: "renamed",
        name: next.name,
        actor: userId,
      }, tx)
      return next
    })
    await this.recordDriveAudit({
      userId,
      action: "drive.rename",
      targetType: "drive.item",
      targetId: updated.id,
      detail: { userId, itemId: updated.id, previousName: item.name, nextName },
      ipAddress: auditContext.ipAddress,
    })
    return toDriveItemDto(updated)
  }

  async moveItem(userId: string, itemId: string, parentId: string | null, auditContext: DriveAuditContext = {}): Promise<DriveItemDto> {
    const item = await this.requireOwnedItem(userId, itemId)
    if (parentId === item.id) throw new BadRequestException("不能移动到自身。")
    if (parentId) await this.requireOwnedFolder(userId, parentId)
    if (item.type === DRIVE_ITEM_TYPE.folder) {
      await this.assertNoFolderCycle(item.id, parentId)
    }
    await this.assertNoSameTypeNameConflict({
      excludeItemId: item.id,
      message: item.type === DRIVE_ITEM_TYPE.folder ? "目标位置已有同名文件夹。" : "目标位置已有同名文件。",
      name: item.name,
      parentId,
      type: item.type,
      userId,
    })
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.driveItem.update({
        where: { id: item.id },
        data: { parentId },
        include: driveItemWithShares,
      })
      await this.recordDriveChange({
        userId,
        itemId: next.id,
        parentId: next.parentId,
        type: "moved",
        name: next.name,
        actor: userId,
      }, tx)
      return next
    })
    await this.recordDriveAudit({
      userId,
      action: "drive.move",
      targetType: "drive.item",
      targetId: updated.id,
      detail: { userId, itemId: updated.id, previousParentId: item.parentId, nextParentId: parentId },
      ipAddress: auditContext.ipAddress,
    })
    return toDriveItemDto(updated)
  }

  private async assertNoSameTypeNameConflict(input: {
    readonly excludeItemId: string
    readonly message: string
    readonly name: string
    readonly parentId: string | null
    readonly type: string
    readonly userId: string
  }): Promise<void> {
    const duplicate = await this.prisma.driveItem.findFirst({
      where: {
        userId: input.userId,
        parentId: input.parentId,
        name: input.name,
        type: input.type,
        deletedAt: null,
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
        publicAsset: null,
        id: { not: input.excludeItemId },
      },
      select: { id: true },
    })
    if (duplicate) throw new BadRequestException(input.message)
  }

  async deleteItem(
    userId: string,
    itemId: string,
    _actorEmail = userId,
    ipAddress = "system",
  ): Promise<{ readonly ok: true }> {
    await this.getLifecycleService().trashItem({ userId, itemId, actorId: userId, ipAddress })
    return { ok: true }
  }

  listTrash(userId: string, input: { readonly offset?: number; readonly limit?: number; readonly search?: string } = {}): Promise<DriveTrashListPageDto> {
    return this.getLifecycleService().listTrash(userId, input)
  }

  restoreItem(userId: string, itemId: string, actorId = userId, ipAddress = "system"): Promise<DriveItemDto> {
    return this.getLifecycleService().restoreItem({ userId, itemId, actorId, ipAddress })
  }

  hideTrashedItem(userId: string, itemId: string, actorId = userId, ipAddress = "system"): Promise<{ readonly ok: true }> {
    return this.getLifecycleService().hideTrashedItem({ userId, itemId, actorId, ipAddress, allowPublicAsset: true })
  }

  async createShare(
    userId: string,
    itemId: string,
    publicAppUrl: string,
    settings?: DriveAccessSettingsInput,
    auditContext: DriveAuditContext = {},
  ): Promise<DriveShareDto> {
    const item = await this.requireOwnedItem(userId, itemId)
    if (item.storageStatus !== DRIVE_STORAGE_STATUS.active || item.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active) {
      throw new BadRequestException("文件尚不可分享。")
    }
    const existing = await this.prisma.driveShare.findFirst({
      where: { itemId: item.id, userId, enabled: true },
      include: driveShareWithEditors,
    })
    const reusedExisting = Boolean(existing && settings === undefined)
    let share = existing
    let password = existing?.passwordEnabled ? this.decryptStoredPassword(existing.passwordEncrypted) : null
    if (!share || settings !== undefined) {
      const normalizedSettings = normalizeDriveAccessSettings(settings ?? DRIVE_DEFAULT_ACCESS_SETTINGS)
      const material = await createDrivePasswordMaterial(normalizedSettings, this.accessSecret)
      share = existing
        ? await this.updateShareAccessSettings(existing.id, material, normalizedSettings.accessMode, normalizedSettings.editorEmails)
        : await this.createUniqueShare(item.id, userId, item.type, material, normalizedSettings.accessMode, normalizedSettings.editorEmails)
      password = material.password
    }
    const dto = toDriveShareDto(share, publicAppUrl, password)
    await this.recordDriveAudit({
      userId,
      action: "drive.share.create",
      targetType: "drive.share",
      targetId: share.id,
      detail: {
        userId,
        itemId: item.id,
        shareRecordId: share.id,
        shareId: share.shareId,
        itemType: item.type,
        passwordEnabled: dto.passwordEnabled,
        expiresAt: dto.expiresAt,
        accessMode: dto.accessMode,
        editorCount: dto.editorEmails.length,
        reusedExisting,
        settingsUpdated: Boolean(existing && settings !== undefined),
      },
      ipAddress: auditContext.ipAddress,
    })
    return dto
  }

  async disableShare(userId: string, shareId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const share = await this.prisma.driveShare.findFirst({
      where: { userId, enabled: true, OR: [{ id: shareId }, { shareId }] },
      select: { id: true, shareId: true },
    })
    if (!share) throw new NotFoundException("分享不存在。")
    const result = await this.prisma.driveShare.updateMany({
      where: { id: share.id, userId, enabled: true },
      data: { enabled: false, disabledAt: new Date() },
    })
    if (result.count === 0) throw new NotFoundException("分享不存在。")
    await this.recordDriveAudit({
      userId,
      action: "drive.share.disable",
      targetType: "drive.share",
      targetId: share.id,
      detail: { userId, shareRecordId: share.id, shareId: share.shareId, requestedShareId: shareId, disabledCount: result.count },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true }
  }

  async listShares(userId: string, publicAppUrl: string, page?: DrivePublicLinksPageInput): Promise<DriveShareListPageDto> {
    const pageInput = normalizeDrivePublicLinksPage(page)
    const now = new Date()
    const where: Prisma.DriveShareWhereInput = {
      userId,
      enabled: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      item: { is: { publicAsset: null } },
    }
    if (pageInput.search) {
      where.AND = [{
        OR: [
          { id: { contains: pageInput.search, mode: "insensitive" } },
          { shareId: { contains: pageInput.search, mode: "insensitive" } },
          { item: { is: { name: { contains: pageInput.search, mode: "insensitive" } } } },
        ],
      }]
    }
    const shares = await this.prisma.driveShare.findMany({
      where,
      include: { item: { select: { id: true, name: true, type: true, deletedAt: true, lifecycleStatus: true } }, ...driveShareWithEditors },
      orderBy: { createdAt: "desc" },
      skip: pageInput.offset,
      take: pageInput.limit + 1,
    })
    const items: DriveShareListItemDto[] = shares.slice(0, pageInput.limit).map((share) => this.toDriveShareListItemDto(share, publicAppUrl))
    return {
      items,
      page: buildDrivePublicLinksPage(pageInput, shares.length),
    }
  }

  async getShare(userId: string, shareId: string, publicAppUrl: string): Promise<DriveShareListItemDto> {
    const now = new Date()
    const share = await this.prisma.driveShare.findFirst({
      where: {
        userId,
        enabled: true,
        OR: [{ id: shareId }, { shareId }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        item: { is: { publicAsset: null } },
      },
      include: { item: { select: { id: true, name: true, type: true, deletedAt: true, lifecycleStatus: true } }, ...driveShareWithEditors },
    })
    if (!share) throw new NotFoundException("分享不存在。")
    return this.toDriveShareListItemDto(share, publicAppUrl)
  }

  private toDriveShareListItemDto(
    share: {
      id: string
      shareId: string
      itemId: string
      item: { readonly name: string; readonly type: string; readonly deletedAt: Date | null; readonly lifecycleStatus: string }
      passwordEnabled: boolean
      passwordEncrypted: string | null
      expiresAt: Date | null
      accessMode: string
      editors: readonly { readonly email: string }[]
      createdAt: Date
    },
    publicAppUrl: string,
  ): DriveShareListItemDto {
    const url = buildDriveShareUrl({ publicAppUrl, shareId: share.shareId })
    const password = share.passwordEnabled ? this.decryptStoredPassword(share.passwordEncrypted) : null
    return {
      id: share.id,
      shareId: share.shareId,
      itemId: share.itemId,
      itemName: share.item.name,
      itemType: share.item.type === DRIVE_ITEM_TYPE.folder ? "folder" : "file",
      sourceDeleted: share.item.deletedAt !== null || share.item.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active,
      url,
      urlWithPassword: buildDriveUrlWithPassword(url, password),
      passwordEnabled: share.passwordEnabled,
      password,
      expiresAt: share.expiresAt?.toISOString() ?? null,
      accessMode: normalizeDriveShareAccessMode(share.accessMode),
      editorEmails: share.editors.map((editor) => editor.email),
      createdAt: share.createdAt.toISOString(),
    }
  }

  async getUsage(userId: string): Promise<DriveUsageDto> {
    const usage = await ensureUsage(this.prisma, userId)
    return {
      usedBytes: usage.usedBytes.toString(),
      reservedBytes: usage.reservedBytes.toString(),
      quotaBytes: usage.quotaBytes.toString(),
    }
  }

  async getStats(userId: string): Promise<DriveStatsDto> {
    const usage = await ensureUsage(this.prisma, userId)
    const [itemCount, fileCount, folderCount] = await this.prisma.$transaction([
      this.prisma.driveItem.count({ where: ordinaryDriveItemWhere({ userId }) }),
      this.prisma.driveItem.count({ where: ordinaryDriveItemWhere({ userId, type: DRIVE_ITEM_TYPE.file }) }),
      this.prisma.driveItem.count({ where: ordinaryDriveItemWhere({ userId, type: DRIVE_ITEM_TYPE.folder }) }),
    ])
    return {
      itemCount,
      fileCount,
      folderCount,
      usedBytes: usage.usedBytes.toString(),
      reservedBytes: usage.reservedBytes.toString(),
      quotaBytes: usage.quotaBytes.toString(),
    }
  }

  async listItemTree(userId: string, input: DriveItemTreeListInput = {}): Promise<DriveItemTreeListPageDto> {
    const parentId = input.parentId ?? null
    const page = normalizeDriveItemTreePage(input)
    if (typeof this.prisma.$queryRaw === "function") {
      return this.listItemTreeWithRecursiveQuery(userId, parentId, page)
    }
    if (parentId) await this.requireOwnedFolder(userId, parentId)
    const items = await this.prisma.driveItem.findMany({
      where: ordinaryDriveItemWhere({ userId }),
      include: driveItemWithShares,
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    })
    const entries = buildDriveItemTreeEntries(items.map(toDriveItemDto), parentId)
    const pageItems = entries.slice(page.offset, page.offset + page.limit)
    return {
      items: pageItems,
      total: entries.length,
      fileCount: entries.filter((item) => item.type === "file").length,
      folderCount: entries.filter((item) => item.type === "folder").length,
      hasMore: page.offset + page.limit < entries.length,
      nextOffset: page.offset + page.limit < entries.length ? page.offset + page.limit : null,
    }
  }

  private async listItemTreeWithRecursiveQuery(
    userId: string,
    parentId: string | null,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<DriveItemTreeListPageDto> {
    const parentPath = parentId ? await this.resolveOwnedItemPath(userId, await this.requireOwnedFolder(userId, parentId)) : ""
    const rootPredicate = parentId
      ? Prisma.sql`di."parentId" = ${parentId}`
      : Prisma.sql`di."parentId" IS NULL`
    const rootDepth = parentId ? 1 : 0
    const rootPathPrefix = parentPath ? `${parentPath}/` : ""
    const rows = await this.prisma.$queryRaw<DriveItemTreeQueryRow[]>`
      WITH RECURSIVE tree AS (
        SELECT
          di.id,
          di."parentId",
          di.type,
          di.name,
          di.size,
          di."mimeType",
          di."storageStatus",
          di."createdAt",
          di."updatedAt",
          concat(${rootPathPrefix}, di.name)::text AS path,
          ${rootDepth}::int AS depth,
          ARRAY[
            concat(
              di.type,
              ':',
              lpad((9223372036854775807::numeric - floor(extract(epoch from di."createdAt") * 1000000))::text, 22, '0'),
              ':',
              di.id
            )
          ]::text[] AS sort_path
        FROM "DriveItem" di
        WHERE di."userId" = ${userId}
          AND ${rootPredicate}
          AND di."deletedAt" IS NULL
          AND di."lifecycleStatus" = ${DRIVE_ITEM_LIFECYCLE_STATUS.active}
          AND NOT EXISTS (SELECT 1 FROM "PublicAsset" pa WHERE pa."itemId" = di.id)
          AND NOT EXISTS (
            SELECT 1
            FROM "DriveUploadSession" dus
            WHERE dus."itemId" = di.id
              AND dus.purpose = ${DRIVE_UPLOAD_PURPOSE.publicAssetUpload}
              AND dus.status = ${DRIVE_UPLOAD_STATUS.pending}
          )

        UNION ALL

        SELECT
          child.id,
          child."parentId",
          child.type,
          child.name,
          child.size,
          child."mimeType",
          child."storageStatus",
          child."createdAt",
          child."updatedAt",
          concat(tree.path, '/', child.name)::text AS path,
          tree.depth + 1 AS depth,
          tree.sort_path || concat(
            child.type,
            ':',
            lpad((9223372036854775807::numeric - floor(extract(epoch from child."createdAt") * 1000000))::text, 22, '0'),
            ':',
            child.id
          )
        FROM "DriveItem" child
        INNER JOIN tree ON child."parentId" = tree.id
        WHERE child."userId" = ${userId}
          AND child."deletedAt" IS NULL
          AND child."lifecycleStatus" = ${DRIVE_ITEM_LIFECYCLE_STATUS.active}
          AND NOT EXISTS (SELECT 1 FROM "PublicAsset" pa WHERE pa."itemId" = child.id)
          AND NOT EXISTS (
            SELECT 1
            FROM "DriveUploadSession" dus
            WHERE dus."itemId" = child.id
              AND dus.purpose = ${DRIVE_UPLOAD_PURPOSE.publicAssetUpload}
              AND dus.status = ${DRIVE_UPLOAD_STATUS.pending}
          )
      ),
      stats AS (
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE tree.type = ${DRIVE_ITEM_TYPE.file}) AS "fileCount",
          count(*) FILTER (WHERE tree.type = ${DRIVE_ITEM_TYPE.folder}) AS "folderCount"
        FROM tree
      ),
      paged AS (
        SELECT *
        FROM tree
        ORDER BY tree.sort_path
        OFFSET ${page.offset}
        LIMIT ${page.limit + 1}
      )
      SELECT
        paged.id,
        paged."parentId",
        paged.type,
        paged.name,
        paged.size,
        paged."mimeType",
        paged."storageStatus",
        paged."createdAt",
        paged."updatedAt",
        paged.path,
        paged.depth,
        stats.total,
        stats."fileCount",
        stats."folderCount",
        share.id AS "activeShareId"
      FROM stats
      LEFT JOIN paged ON true
      LEFT JOIN LATERAL (
        SELECT ds.id
        FROM "DriveShare" ds
        WHERE ds."itemId" = paged.id
          AND ds.enabled = true
          AND (ds."expiresAt" IS NULL OR ds."expiresAt" > NOW())
        ORDER BY ds."createdAt" DESC
        LIMIT 1
      ) share ON true
      ORDER BY paged.sort_path
    `
    const entryRows = rows.filter(isDriveItemTreeEntryQueryRow)
    const pageRows = entryRows.slice(0, page.limit)
    const statsRow = rows[0]
    const total = statsRow ? numericCount(statsRow.total) : 0
    const fileCount = statsRow ? numericCount(statsRow.fileCount) : 0
    const folderCount = statsRow ? numericCount(statsRow.folderCount) : 0
    const hasMore = entryRows.length > page.limit
    return {
      items: pageRows.map(toDriveItemTreeEntryDto),
      total,
      fileCount,
      folderCount,
      hasMore,
      nextOffset: hasMore ? page.offset + page.limit : null,
    }
  }

  async ensureFolderPath(userId: string, input: DriveFolderPathEnsureInput, auditContext: DriveAuditContext = {}): Promise<DriveFolderPathEnsureResultDto> {
    const segments = normalizeDriveFolderPathSegments(input.segments)
    let parentId = input.parentId ?? null
    if (parentId) await this.requireOwnedFolder(userId, parentId)
    const created: DriveItemDto[] = []
    const reused: DriveItemDto[] = []

    for (const name of segments) {
      const fileCollision = await this.prisma.driveItem.findFirst({
        where: { userId, parentId, name, type: DRIVE_ITEM_TYPE.file, deletedAt: null, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active, publicAsset: null },
        select: { id: true },
      })
      if (fileCollision) throw new BadRequestException("路径中存在同名文件。")

      const existingFolder = await this.prisma.driveItem.findFirst({
        where: { userId, parentId, name, type: DRIVE_ITEM_TYPE.folder, deletedAt: null, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active },
        include: driveItemWithShares,
      })
      if (existingFolder) {
        const dto = toDriveItemDto(existingFolder)
        reused.push(dto)
        parentId = dto.id
        continue
      }

      const folder = await this.prisma.driveItem.create({
        data: {
          userId,
          parentId,
          type: DRIVE_ITEM_TYPE.folder,
          name,
          size: 0n,
          storageStatus: DRIVE_STORAGE_STATUS.active,
          uploadStatus: DRIVE_UPLOAD_STATUS.completed,
        },
        include: driveItemWithShares,
      })
      const dto = toDriveItemDto(folder)
      created.push(dto)
      parentId = dto.id
    }

    const item = created.at(-1) ?? reused.at(-1)
    if (!item) throw new BadRequestException("文件夹路径不能为空。")
    await this.recordDriveAudit({
      userId,
      action: "drive.folder_path.ensure",
      targetType: "drive.item",
      targetId: item.id,
      detail: { userId, itemId: item.id, createdCount: created.length, reusedCount: reused.length },
      ipAddress: auditContext.ipAddress,
    })
    return { item, created, reused }
  }

  async previewReorganization(userId: string, input: DriveReorganizationPreviewInput): Promise<DriveReorganizationPreviewDto> {
    const moves = await this.resolveReorganizationMoves(userId, input)
    const planId = `drive-reorg-${randomUUID()}`
    const expiresAt = new Date(Date.now() + DRIVE_REORGANIZATION_PLAN_TTL_MS)
    const plan: DriveReorganizationPlan = {
      userId,
      planId,
      expiresAt,
      moves: moves.planned,
      skipped: moves.skipped,
    }
    this.reorganizationPlans.set(planId, plan)
    this.pruneExpiredReorganizationPlans()
    return {
      planId,
      expiresAt: expiresAt.toISOString(),
      summary: {
        moveCount: moves.planned.length,
        skippedCount: moves.skipped.length,
        conflictCount: 0,
      },
      moves: moves.planned,
      skipped: moves.skipped,
      conflicts: [],
    }
  }

  async applyReorganization(
    userId: string,
    input: DriveReorganizationApplyInput,
    auditContext: DriveAuditContext = {},
  ): Promise<DriveReorganizationApplyResultDto> {
    const plan = this.reorganizationPlans.get(input.planId)
    if (!plan || plan.userId !== userId) throw new BadRequestException("整理计划不存在或已过期。")
    if (plan.expiresAt.getTime() <= Date.now()) {
      this.reorganizationPlans.delete(input.planId)
      throw new BadRequestException("整理计划已过期，请重新预检。")
    }

    const validated = await this.validateReorganizationPlan(userId, plan)
    await this.prisma.$transaction(async (tx) => {
      for (const move of validated) {
        await tx.driveItem.update({
          where: { id: move.itemId },
          data: { parentId: move.targetParentId },
        })
      }
    })
    this.reorganizationPlans.delete(input.planId)
    const auditMoves = summarizeReorganizationMoves(validated)
    const moveDetailsTruncated = validated.length > auditMoves.length
    await this.recordDriveAudit({
      userId,
      action: "drive.reorganization.apply",
      targetType: "drive.item",
      targetId: input.planId,
      detail: {
        userId,
        planId: input.planId,
        movedCount: validated.length,
        skippedCount: plan.skipped.length,
        moves: auditMoves,
        ...(moveDetailsTruncated ? { moveDetailsTruncated } : {}),
      },
      ipAddress: auditContext.ipAddress,
    })
    return {
      ok: true,
      movedCount: validated.length,
      skippedCount: plan.skipped.length,
      moves: auditMoves,
      ...(moveDetailsTruncated ? { moveDetailsTruncated } : {}),
    }
  }

  async getOwnerBrowserSnapshot(input: {
    readonly userId: string
    readonly itemId: string
    readonly surface: "standalone" | "console"
    readonly childrenPage?: DriveBrowserChildrenPageInput
  }): Promise<DriveBrowserSnapshotDto> {
    const { root, current } = await this.resolveOwnedBrowserCurrent(input)
    const route: DriveBrowserRouteContext = { context: "owner", surface: input.surface }
    const children = current.type === DRIVE_ITEM_TYPE.folder
      ? await this.listActiveChildrenPage(root.userId, current.id, input.childrenPage)
      : emptyDriveBrowserChildrenPage(input.childrenPage)
    const preview = await this.buildBrowserPreview(current, route)

    return {
      context: "owner",
      surface: input.surface,
      current: buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(current), route }),
      breadcrumbs: await this.buildOwnedBrowserBreadcrumbs(root.userId, root, current, route),
      children: children.items.map((item) => buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(item), route })),
      childrenPage: children.page,
      preview,
      edit: buildDriveBrowserEdit({
        canWrite: true,
        item: current,
        preview,
        currentVersionId: await this.findCurrentDriveFileVersionId(current),
      }),
      annotation: buildDriveBrowserAnnotationCapability({ item: current, canComment: true }),
      canDownload: current.type === DRIVE_ITEM_TYPE.file,
      canZip: current.type === DRIVE_ITEM_TYPE.folder,
    }
  }

  async getOwnerConsoleRootBrowserSnapshot(userId: string, childrenPage?: DriveBrowserChildrenPageInput): Promise<DriveBrowserSnapshotDto> {
    const pageInput = normalizeDriveBrowserChildrenPage(childrenPage)
    const children = await this.prisma.driveItem.findMany({
      where: { userId, parentId: null, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active, publicAsset: null },
      include: driveItemWithShares,
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
      skip: pageInput.offset,
      take: pageInput.limit + 1,
    })
    const page = buildDriveBrowserChildrenPage(pageInput, children.length)
    const pageItems = children.slice(0, pageInput.limit)

    return {
      context: "owner",
      surface: "console",
      current: buildConsoleDriveRootItemDto(),
      breadcrumbs: [buildConsoleDriveRootBreadcrumb()],
      children: pageItems.map((item) => buildDriveBrowserItemDto({
        item: toDriveBrowserSourceItem(item),
        route: { context: "owner", surface: "console" },
      })),
      childrenPage: page,
      preview: null,
      edit: null,
      annotation: null,
      canDownload: false,
      canZip: false,
    }
  }

  async openOwnerBrowserItemDownload(input: {
    readonly userId: string
    readonly itemId: string
  }): Promise<DriveBrowserTransferResult> {
    const { current } = await this.resolveOwnedBrowserCurrent(input)
    if (current.type === DRIVE_ITEM_TYPE.folder) {
      return {
        kind: "zip",
        filename: `${current.name}.zip`,
        entries: this.createFolderZipEntries(current.userId, current.id),
      }
    }
    const storageKey = this.requireActiveFileStorage(current)
    const object = await this.storage.getObjectStream({ key: storageKey })
    return {
      kind: "file",
      stream: object.stream,
      fileName: current.name,
      size: object.size ?? current.size,
      contentType: object.contentType ?? current.mimeType,
    }
  }

  async resolveOwnerRenderAccess(input: {
    readonly userId: string
    readonly itemId: string
  }): Promise<DriveRenderedAssetValue> {
    const { current } = await this.resolveOwnedBrowserCurrent(input)
    const storageKey = this.requireActiveFileStorage(current)
    if (!isHtmlDriveItem(current.name, current.mimeType)) throw new BadRequestException("只能访问 HTML 文件。")
    const object = await this.storage.getObjectStream({ key: storageKey })
    return {
      stream: object.stream,
      size: object.size ?? current.size,
      contentType: "text/html; charset=utf-8",
    }
  }

  async getShareBrowserSnapshot(input: {
    readonly shareId: string
    readonly itemId?: string | null
    readonly password?: string
    readonly cookie?: string
    readonly accessCookie?: string
    readonly actorUserId?: string | null
    readonly childrenPage?: DriveBrowserChildrenPageInput
  }): Promise<DriveBrowserSnapshotDto> {
    const share = await this.resolvePublicShare({
      shareId: input.shareId,
      password: input.password,
      cookie: input.cookie ?? input.accessCookie,
    })
    const { root, current } = await this.resolveShareBrowserCurrent(share, input.itemId)
    const route: DriveBrowserRouteContext = {
      context: "share",
      surface: "standalone",
      shareId: input.shareId,
      rootItemId: root.id,
    }
    const children = current.type === DRIVE_ITEM_TYPE.folder
      ? await this.listActiveChildrenPage(share.ownerId, current.id, input.childrenPage)
      : emptyDriveBrowserChildrenPage(input.childrenPage)
    const preview = await this.buildBrowserPreview(current, route)
    const shareWrite = await this.resolveShareWriteSnapshotState(share, input.actorUserId ?? null)

    return {
      context: "share",
      surface: "standalone",
      current: buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(current), route }),
      breadcrumbs: await this.buildShareBrowserBreadcrumbs(share.ownerId, root, current, route),
      children: children.items.map((item) => buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(item), route })),
      childrenPage: children.page,
      preview,
      edit: buildDriveBrowserEdit({
        canWrite: shareWrite.canWrite,
        item: current,
        preview,
        currentVersionId: await this.findCurrentDriveFileVersionId(current),
        unauthenticatedEditableShare: shareWrite.loginRequired,
      }),
      annotation: buildDriveBrowserAnnotationCapability({
        item: current,
        canComment: Boolean(input.actorUserId),
        reason: input.actorUserId ? null : "login_required",
      }),
      canDownload: current.type === DRIVE_ITEM_TYPE.file,
      canZip: current.type === DRIVE_ITEM_TYPE.folder,
    }
  }

  async openShareBrowserItemDownload(input: {
    readonly shareId: string
    readonly itemId?: string | null
    readonly password?: string
    readonly cookie?: string
    readonly accessCookie?: string
  }): Promise<DriveBrowserTransferResult> {
    const share = await this.resolvePublicShare({
      shareId: input.shareId,
      password: input.password,
      cookie: input.cookie ?? input.accessCookie,
    })
    const { current } = await this.resolveShareBrowserCurrent(share, input.itemId)
    if (current.type === DRIVE_ITEM_TYPE.folder) {
      return {
        kind: "zip",
        filename: `${current.name}.zip`,
        entries: this.createFolderZipEntries(share.ownerId, current.id),
      }
    }
    const storageKey = this.requireActiveFileStorage(current)
    const object = await this.storage.getObjectStream({ key: storageKey })
    return {
      kind: "file",
      stream: object.stream,
      fileName: current.name,
      size: object.size ?? current.size,
      contentType: object.contentType ?? current.mimeType,
    }
  }

  async resolveShareRenderAccess(input: {
    readonly shareId: string
    readonly itemId?: string | null
    readonly password?: string
    readonly cookie?: string
    readonly accessCookie?: string
  }): Promise<DrivePublicAccessResult<DriveRenderedAssetValue>> {
    const access = await this.resolvePublicShareAccess({
      shareId: input.shareId,
      password: input.password,
      cookie: input.cookie ?? input.accessCookie,
    })
    if (access.status !== "ok") return access
    const { current } = await this.resolveShareBrowserCurrent(access.value, input.itemId)
    const storageKey = this.requireActiveFileStorage(current)
    if (!isHtmlDriveItem(current.name, current.mimeType)) {
      throw new BadRequestException("只能访问 HTML 文件。")
    }
    const object = await this.storage.getObjectStream({ key: storageKey })
    return {
      status: "ok",
      value: {
        stream: object.stream,
        size: object.size ?? current.size,
        contentType: "text/html; charset=utf-8",
      },
      ...(access.cookie ? { cookie: access.cookie } : {}),
    }
  }

  async resolvePublicShareAccess(input: {
    readonly shareId: string
    readonly password?: string
    readonly cookie?: string
    readonly now?: Date
  }): Promise<DrivePublicAccessResult<DrivePublicShareValue>> {
    const now = input.now ?? new Date()
    const share = await this.prisma.driveShare.findFirst({
      where: { shareId: input.shareId, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], item: { is: { publicAsset: null } } },
      include: { item: { include: { ...driveItemWithShares, publicAsset: true } }, ...driveShareWithEditors },
    })
    if (
      !share
      || share.item.deletedAt
      || share.item.storageStatus !== DRIVE_STORAGE_STATUS.active
      || share.item.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active
      || share.item.publicAsset
    ) {
      throw new NotFoundException("文件未找到")
    }

    if (share.passwordEnabled) {
      const cookieOk = verifyDriveAccessCookie(input.cookie, {
        kind: "share",
        publicId: share.shareId,
        now,
        passwordHash: share.passwordHash,
        resourceExpiresAt: share.expiresAt,
        secret: this.accessSecret,
      })
      const passwordOk = await verifyDrivePasswordInput(input.password, share.passwordHash)
      if (!cookieOk && !passwordOk) return { status: "password_required" }
      return {
        status: "ok",
        value: toDrivePublicShareValue(share),
        ...(passwordOk
          ? {
            cookie: buildDriveAccessCookie({
              kind: "share",
              publicId: share.shareId,
              expiresAt: share.expiresAt,
              passwordHash: share.passwordHash,
              secret: this.accessSecret,
            }),
          }
          : {}),
      }
    }

    return { status: "ok", value: toDrivePublicShareValue(share) }
  }

  private async resolvePublicShare(input: {
    readonly shareId: string
    readonly password?: string
    readonly cookie?: string
  }): Promise<DrivePublicShareValue> {
    const result = await this.resolvePublicShareAccess(input)
    if (result.status !== "ok") throw new NotFoundException("文件未找到")
    return result.value
  }

  async listAdminItems(options: { pagination: PaginationQuery; filters: DriveAdminFilters }): Promise<PaginatedResponse<DriveAdminItemDto>> {
    const where = buildAdminWhere(options.filters)
    const [data, total] = await this.prisma.$transaction([
      this.prisma.driveItem.findMany({
        ...toPrismaArgs(options.pagination),
        where,
        include: { ...driveItemWithShares, user: { select: { email: true } } },
      }),
      this.prisma.driveItem.count({ where }),
    ])
    return {
      data: data.map((item) => ({
        ...toDriveItemDto(item),
        userId: item.userId,
        userEmail: item.user.email,
        storageDeletePending: item.storageDeletePending,
        lifecycleStatus: item.lifecycleStatus as DriveAdminItemDto["lifecycleStatus"],
      })),
      total,
      page: options.pagination.page,
      pageSize: options.pagination.pageSize,
    }
  }

  async deleteItemAsAdmin(itemId: string, actorEmail: string, ipAddress: string): Promise<{ readonly ok: true }> {
    const item = await this.prisma.driveItem.findFirst({ where: { id: itemId } })
    if (!item) throw new NotFoundException("文件不存在。")
    if (item.lifecycleStatus === DRIVE_ITEM_LIFECYCLE_STATUS.trashed) {
      await this.getLifecycleService().hideTrashedItem({ userId: item.userId, itemId, actorId: actorEmail, ipAddress, allowPublicAsset: true })
      return { ok: true }
    }
    if (item.lifecycleStatus === DRIVE_ITEM_LIFECYCLE_STATUS.hidden) return { ok: true }
    await this.getLifecycleService().trashItem({ userId: item.userId, itemId, actorId: actorEmail, ipAddress, allowPublicAsset: true })
    return { ok: true }
  }

  async openAdminItemDownload(itemId: string): Promise<DriveBrowserDownloadResult> {
    const item = await this.prisma.driveItem.findFirst({ where: { id: itemId } })
    if (!item) throw new NotFoundException("文件不存在。")
    if (item.type !== DRIVE_ITEM_TYPE.file) throw new BadRequestException("只能下载文件。")
    if (!item.storageKey || item.storageStatus !== DRIVE_STORAGE_STATUS.active) throw new NotFoundException("文件不存在。")
    const object = await this.storage.getObjectStream({ key: item.storageKey })
    return {
      stream: object.stream,
      fileName: item.name,
      size: object.size ?? item.size,
      contentType: object.contentType ?? item.mimeType,
    }
  }

  async restoreItemAsAdmin(itemId: string, actorEmail: string, ipAddress: string): Promise<DriveItemDto> {
    const item = await this.prisma.driveItem.findFirst({ where: { id: itemId } })
    if (!item) throw new NotFoundException("文件不存在。")
    return this.getLifecycleService().restoreItemAsAdmin({ userId: item.userId, itemId: item.id, actorId: actorEmail, ipAddress })
  }

  async getAdminStorageSummary(): Promise<DriveAdminStorageSummaryDto> {
    const visibleLifecycleStatuses = [
      DRIVE_ITEM_LIFECYCLE_STATUS.active,
      DRIVE_ITEM_LIFECYCLE_STATUS.trashed,
      DRIVE_ITEM_LIFECYCLE_STATUS.hidden,
    ]
    const [normalDriveGroups, publicAssetGroups, publicAssetRevisionAggregate] = await this.prisma.$transaction([
      this.prisma.driveItem.groupBy({
        by: ["lifecycleStatus"],
        where: {
          type: DRIVE_ITEM_TYPE.file,
          storageStatus: DRIVE_STORAGE_STATUS.active,
          lifecycleStatus: { in: visibleLifecycleStatuses },
          publicAsset: null,
        },
        _count: { _all: true },
        _sum: { size: true },
      }),
      this.prisma.publicAsset.groupBy({
        by: ["lifecycleStatus"],
        where: {
          deletedAt: null,
          lifecycleStatus: { in: visibleLifecycleStatuses },
        },
        _count: { _all: true },
        _sum: { size: true },
      }),
      this.prisma.publicAssetRevision.aggregate({
        _count: { _all: true },
        _sum: { size: true },
      }),
    ])
    const normalDrive = buildAdminStorageBucket(normalDriveGroups)
    const publicAssetBucket = buildAdminStorageBucket(publicAssetGroups)
    const revisionBytes = publicAssetRevisionAggregate._sum.size ?? 0n
    const quotaBytes = bucketQuotaBytes(normalDrive) + bucketQuotaBytes(publicAssetBucket)
    const adminVisibleBytes = quotaBytes + BigInt(normalDrive.hidden.bytes) + BigInt(publicAssetBucket.hidden.bytes) + revisionBytes
    return {
      normalDrive,
      publicAssets: publicAssetBucket,
      publicAssetRevisions: {
        count: publicAssetRevisionAggregate._count._all,
        bytes: revisionBytes.toString(),
      },
      total: {
        quotaBytes: quotaBytes.toString(),
        adminVisibleBytes: adminVisibleBytes.toString(),
      },
    }
  }

  @Cron("*/15 * * * *")
  async scheduledPendingUploadSessionExpiry(): Promise<void> {
    try {
      await this.expirePendingUploadSessions()
    } catch (error) {
      this.logger.warn({
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
        ...(error instanceof Error && "code" in error && typeof error.code === "string"
          ? { errorCode: error.code }
          : {}),
      }, "Drive pending upload session cleanup failed")
    }
  }

  @Cron("*/30 * * * *")
  async scheduledPendingStorageDeleteRetry(): Promise<void> {
    try {
      await this.retryPendingDriveItemStorageDeletes()
      await this.retryPendingFileVersionDeletes()
    } catch (error) {
      this.logger.warn({
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
        ...(error instanceof Error && "code" in error && typeof error.code === "string"
          ? { errorCode: error.code }
          : {}),
      }, "Drive pending storage delete retry failed")
    }
  }

  async expirePendingUploadSessions(now = new Date()): Promise<{ readonly expired: number }> {
    const sessions = await this.prisma.driveUploadSession.findMany({
      where: { status: DRIVE_UPLOAD_STATUS.pending, expiresAt: { lte: now } },
      select: { id: true, userId: true, reservedBytes: true, itemId: true, storageKey: true },
    })
    for (const session of sessions) {
      const transitioned = await this.failUploadSession(session.userId, session.id, session.itemId, session.reservedBytes, DRIVE_UPLOAD_STATUS.expired, now, session.storageKey)
      if (transitioned) this.lifecycle?.cleanupUploadSessionState(session.id)
    }
    return { expired: sessions.length }
  }

  async backfillLegacyDriveAccessProtection(now = new Date()): Promise<{ readonly shares: number }> {
    const legacyShares = await this.prisma.driveShare.findMany({
      where: { enabled: true, passwordEnabled: false, passwordHash: null, accessSettingsAppliedAt: null },
      select: { id: true },
    })

    let shares = 0
    for (const share of legacyShares) {
      const material = await createDrivePasswordMaterial(DRIVE_DEFAULT_ACCESS_SETTINGS, this.accessSecret, now)
      const result = await this.prisma.driveShare.updateMany({
        where: { id: share.id, enabled: true, passwordEnabled: false, passwordHash: null, accessSettingsAppliedAt: null },
        data: toDrivePasswordUpdateData(material, now),
      })
      if (result.count === 1) shares += 1
    }

    return { shares }
  }

  private async resolveReorganizationMoves(
    userId: string,
    input: DriveReorganizationPreviewInput,
  ): Promise<{
      readonly planned: DriveReorganizationPlannedMoveDto[]
      readonly skipped: Array<{ readonly itemId: string; readonly reason: string }>
    }> {
    if (!Array.isArray(input.moves) || input.moves.length === 0) throw new BadRequestException("整理计划不能为空。")
    const seen = new Set<string>()
    for (const move of input.moves) {
      if (seen.has(move.itemId)) throw new BadRequestException("整理计划包含重复条目。")
      seen.add(move.itemId)
    }

    const planned: DriveReorganizationPlannedMoveDto[] = []
    const skipped: Array<{ readonly itemId: string; readonly reason: string }> = []
    const movedFolders: string[] = []
    const plannedTargetMoves: DriveReorganizationTargetMove[] = []

    for (const move of input.moves) {
      const item = await this.requireOwnedItem(userId, move.itemId)
      const targetParentId = move.targetParentId ?? null
      if (targetParentId === item.id) throw new BadRequestException("不能移动到自身。")
      if (targetParentId) await this.requireOwnedFolder(userId, targetParentId)
      if (item.parentId === targetParentId) {
        skipped.push({ itemId: item.id, reason: "already-in-target" })
        continue
      }
      await this.assertNoSameTypeNameConflict({
        excludeItemId: item.id,
        message: item.type === DRIVE_ITEM_TYPE.folder ? "目标位置已有同名文件夹。" : "目标位置已有同名文件。",
        name: item.name,
        parentId: targetParentId,
        type: item.type,
        userId,
      })
      if (item.type === DRIVE_ITEM_TYPE.folder) {
        await this.assertNoFolderCycle(item.id, targetParentId)
        movedFolders.push(item.id)
      }
      plannedTargetMoves.push({ itemId: item.id, name: item.name, targetParentId, type: item.type })
      planned.push({
        itemId: item.id,
        name: item.name,
        fromParentId: item.parentId,
        targetParentId,
        updatedAt: item.updatedAt.toISOString(),
      })
    }

    await this.assertNoRelatedFoldersInReorganization(movedFolders)
    this.assertNoDuplicateReorganizationMovesInPlan(plannedTargetMoves)
    return { planned, skipped }
  }

  private async validateReorganizationPlan(
    userId: string,
    plan: DriveReorganizationPlan,
  ): Promise<DriveReorganizationPlannedMoveDto[]> {
    const movedFolders: string[] = []
    const plannedTargetMoves: DriveReorganizationTargetMove[] = []
    for (const move of plan.moves) {
      const item = await this.requireOwnedItem(userId, move.itemId)
      if (item.parentId !== move.fromParentId || item.updatedAt.toISOString() !== move.updatedAt || item.name !== move.name) {
        throw new BadRequestException("云盘内容已变化，请重新预检。")
      }
      if (move.targetParentId === item.id) throw new BadRequestException("不能移动到自身。")
      if (move.targetParentId) await this.requireOwnedFolder(userId, move.targetParentId)
      await this.assertNoSameTypeNameConflict({
        excludeItemId: item.id,
        message: item.type === DRIVE_ITEM_TYPE.folder ? "目标位置已有同名文件夹。" : "目标位置已有同名文件。",
        name: item.name,
        parentId: move.targetParentId,
        type: item.type,
        userId,
      })
      if (item.type === DRIVE_ITEM_TYPE.folder) {
        await this.assertNoFolderCycle(item.id, move.targetParentId)
        movedFolders.push(item.id)
      }
      plannedTargetMoves.push({ itemId: item.id, name: item.name, targetParentId: move.targetParentId, type: item.type })
    }
    await this.assertNoRelatedFoldersInReorganization(movedFolders)
    this.assertNoDuplicateReorganizationMovesInPlan(plannedTargetMoves)
    return [...plan.moves]
  }

  private assertNoDuplicateReorganizationMovesInPlan(moves: readonly DriveReorganizationTargetMove[]): void {
    const seenTargets = new Map<string, string>()
    for (const move of moves) {
      const key = `${move.targetParentId ?? "root"}\u0000${move.type}\u0000${move.name}`
      const existingItemId = seenTargets.get(key)
      if (existingItemId && existingItemId !== move.itemId) {
        throw new BadRequestException(move.type === DRIVE_ITEM_TYPE.folder ? "目标位置已有同名文件夹。" : "目标位置已有同名文件。")
      }
      seenTargets.set(key, move.itemId)
    }
  }

  private async assertNoRelatedFoldersInReorganization(folderIds: readonly string[]): Promise<void> {
    const movedFolderIds = new Set(folderIds)
    if (movedFolderIds.size < 2) return

    const parentIdByItemId = new Map<string, string | null>()
    for (const folderId of movedFolderIds) {
      const visited = new Set<string>()
      let currentId: string | null = folderId
      while (currentId) {
        if (visited.has(currentId)) break
        visited.add(currentId)
        const parentId = await this.findCachedDriveItemParentId(currentId, parentIdByItemId)
        if (!parentId) break
        if (movedFolderIds.has(parentId)) throw new BadRequestException("同一整理计划不能同时移动父子文件夹。")
        currentId = parentId
      }
    }
  }

  private async findCachedDriveItemParentId(itemId: string, cache: Map<string, string | null>): Promise<string | null> {
    if (!cache.has(itemId)) {
      const item = await this.prisma.driveItem.findUnique({
        where: { id: itemId },
        select: { parentId: true },
      })
      cache.set(itemId, item?.parentId ?? null)
    }
    return cache.get(itemId) ?? null
  }

  private pruneExpiredReorganizationPlans(now = Date.now()): void {
    for (const [planId, plan] of this.reorganizationPlans.entries()) {
      if (plan.expiresAt.getTime() <= now) this.reorganizationPlans.delete(planId)
    }
  }

  private async requireOwnedItem(userId: string, itemId: string) {
    const item = await this.prisma.driveItem.findFirst({
      where: ordinaryDriveItemWhere({ userId, id: itemId }),
      include: driveItemWithShares,
    })
    if (!item) throw new NotFoundException("文件不存在。")
    return item
  }

  private async requireOwnedFolder(userId: string, folderId: string) {
    const folder = await this.requireOwnedItem(userId, folderId)
    if (folder.type !== DRIVE_ITEM_TYPE.folder) throw new BadRequestException("目标不是文件夹。")
    return folder
  }

  private async resolveOwnedItemPath(
    userId: string,
    item: { readonly id: string; readonly parentId: string | null; readonly name: string },
  ): Promise<string> {
    const parts = [item.name]
    let parentId = item.parentId
    while (parentId) {
      const parent = await this.prisma.driveItem.findFirst({
        where: ordinaryDriveItemWhere({ userId, id: parentId }),
        select: { id: true, parentId: true, name: true },
      })
      if (!parent) break
      parts.unshift(parent.name)
      parentId = parent.parentId
    }
    return parts.join("/")
  }

  private async requireOwnedFile(userId: string, itemId: string) {
    const item = await this.requireOwnedItem(userId, itemId)
    if (item.type !== DRIVE_ITEM_TYPE.file) throw new BadRequestException("目标不是文件。")
    return item
  }

  private async requireOwnedFileVersion(userId: string, itemId: string, versionId: string) {
    const version = await this.prisma.driveFileVersion.findFirst({
      where: { id: versionId, itemId, userId, deletedAt: null },
    })
    if (!version) throw new NotFoundException("历史版本不存在。")
    return version
  }

  private async commitTextFileChange(input: {
    readonly ownerId: string
    readonly actorUserId: string
    readonly item: DriveItemRecordWithStorage
    readonly input: DriveFileTextUpdateInput
    readonly auditContext: DriveAuditContext
    readonly auditAction: string
    readonly shareRecordId?: string
    readonly shareId?: string
  }): Promise<DriveFileContentUpdateResult> {
    if (input.input.contentType !== "text") throw new BadRequestException("编辑内容无效。")
    this.assertEditableTextFile(input.item)
    const body = Buffer.from(input.input.text, "utf8")
    if (body.byteLength > DRIVE_INLINE_TEXT_EDIT_MAX_BYTES) throw new PayloadTooLargeException("文件内容过大。")
    const currentVersionId = await this.findCurrentDriveFileVersionId(input.item)
    if (!currentVersionId || currentVersionId !== input.input.baseVersionId) {
      throw new ConflictException("文件已有新内容。")
    }
    const usage = await ensureUsage(this.prisma, input.ownerId)
    if (usage.usedBytes + usage.reservedBytes + BigInt(body.byteLength) > usage.quotaBytes) {
      throw new BadRequestException("云盘空间不足。")
    }

    const nextVersionId = createDriveFileVersionId()
    const nextStorageKey = driveVersionStorageKey(input.item.id, nextVersionId)
    await this.storage.putObject({
      key: nextStorageKey,
      body,
      contentType: input.item.mimeType,
    })

    let committed = false
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const currentItem = await tx.driveItem.findFirst({
          where: { id: input.item.id, userId: input.ownerId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active },
          include: driveItemWithShares,
        }) as DriveItemRecordWithStorage | null
        if (!currentItem || currentItem.type !== DRIVE_ITEM_TYPE.file || !currentItem.storageKey) throw new NotFoundException("文件不存在。")
        const transactionCurrentVersion = await tx.driveFileVersion.findFirst({
          where: { itemId: currentItem.id, storageKey: currentItem.storageKey, deletedAt: null },
          select: { id: true },
        })
        if (!transactionCurrentVersion || transactionCurrentVersion.id !== input.input.baseVersionId) {
          throw new ConflictException("文件已有新内容。")
        }
        await updateDriveUsageAfterUploadCompletion(tx, input.ownerId, {
          reservedBytes: 0n,
          usedBytesDelta: BigInt(body.byteLength),
        })
        await createDriveFileVersion(tx, {
          id: nextVersionId,
          itemId: currentItem.id,
          userId: input.ownerId,
          storageKey: nextStorageKey,
          size: BigInt(body.byteLength),
          mimeType: currentItem.mimeType,
          source: DRIVE_FILE_VERSION_SOURCE.onlineEdit,
          createdBy: input.actorUserId,
        })
        const item = await tx.driveItem.update({
          where: { id: currentItem.id },
          data: {
            storageKey: nextStorageKey,
            size: BigInt(body.byteLength),
            mimeType: currentItem.mimeType,
            storageStatus: DRIVE_STORAGE_STATUS.active,
            uploadStatus: DRIVE_UPLOAD_STATUS.completed,
          },
          include: driveItemWithShares,
        })
        const version = await tx.driveFileVersion.findUnique({
          where: { id: nextVersionId },
        })
        if (!version) throw new NotFoundException("历史版本不存在。")
        await this.recordDriveChange({
          userId: input.ownerId,
          itemId: item.id,
          parentId: item.parentId,
          type: "content_updated",
          versionId: version.id,
          etag: version.etag,
          name: item.name,
          actor: input.actorUserId,
        }, tx)
        return { item, version }
      })
      committed = true
      await this.recordDriveAudit({
        userId: input.actorUserId,
        action: input.auditAction,
        targetType: "drive.item",
        targetId: result.item.id,
        detail: {
          ownerId: input.ownerId,
          actorUserId: input.actorUserId,
          itemId: result.item.id,
          versionId: result.version.id,
          size: result.version.size.toString(),
          ...(input.shareRecordId ? { shareRecordId: input.shareRecordId } : {}),
          ...(input.shareId ? { shareId: input.shareId } : {}),
        },
        ipAddress: input.auditContext.ipAddress,
      })
      await this.cleanupFileVersionsAfterChange(input.ownerId, result.item.id)
      return {
        item: toDriveItemDto(result.item),
        version: toDriveFileVersionDto(result.version, result.item.storageKey),
      }
    } catch (error) {
      if (!committed) await this.deleteTemporaryUploadObject(nextStorageKey)
      if (isUniqueConstraintError(error)) throw new ConflictException("文件已有新内容。")
      throw error
    }
  }

  private assertEditableTextFile(item: DriveItemRecordWithStorage): void {
    if (item.type !== DRIVE_ITEM_TYPE.file || !item.storageKey) throw new BadRequestException("目标不是文件。")
    const previewKind = resolveDriveBrowserPreviewKind(toDriveBrowserSourceItem(item))
    if (!isDriveTextEditablePreviewKind(previewKind)) throw new BadRequestException("文件类型暂不支持编辑。")
    if (item.size > BigInt(DRIVE_INLINE_TEXT_EDIT_MAX_BYTES)) throw new PayloadTooLargeException("文件内容过大。")
  }

  private async resolveOwnedBrowserCurrent(input: {
    readonly userId: string
    readonly itemId: string
  }): Promise<{ readonly root: DriveItemRecordWithStorage; readonly current: DriveItemRecordWithStorage }> {
    const current = await this.requireOwnedItem(input.userId, input.itemId) as DriveItemRecordWithStorage
    this.assertActiveBrowserItem(current)
    const root = await this.findOwnerBrowserRoot(input.userId, current)
    return { root, current }
  }

  private async findOwnerBrowserRoot(userId: string, item: DriveItemRecordWithStorage): Promise<DriveItemRecordWithStorage> {
    let cursor = item
    while (cursor.parentId) {
      const parent = await this.findActiveDriveItem(userId, cursor.parentId)
      if (!parent) throw new NotFoundException("文件未找到")
      cursor = parent
    }
    return cursor
  }

  private async resolveShareBrowserCurrent(
    share: DrivePublicShareValue,
    currentItemId?: string | null,
  ): Promise<{ readonly root: DriveItemRecordWithStorage; readonly current: DriveItemRecordWithStorage }> {
    const root = await this.findActiveDriveItem(share.ownerId, share.item.id)
    if (!root) throw new NotFoundException("文件未找到")
    if (!currentItemId || currentItemId === root.id) return { root, current: root }
    if (share.type !== "folder") throw new NotFoundException("文件未找到")

    const current = await this.findActiveDriveItem(share.ownerId, currentItemId)
    if (!current || !await this.isDescendantOf(current.id, root.id)) throw new NotFoundException("文件未找到")
    return { root, current }
  }

  private async findActiveDriveItem(userId: string, itemId: string): Promise<DriveItemRecordWithStorage | null> {
    return this.prisma.driveItem.findFirst({
      where: { id: itemId, userId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active, publicAsset: null },
      include: driveItemWithShares,
    }) as Promise<DriveItemRecordWithStorage | null>
  }

  private async findCurrentDriveFileVersionId(item: {
    readonly id: string
    readonly type: string
    readonly storageKey: string | null
  }): Promise<string | null> {
    if (item.type !== DRIVE_ITEM_TYPE.file || !item.storageKey) return null
    const version = await this.prisma.driveFileVersion.findFirst({
      where: { itemId: item.id, storageKey: item.storageKey, deletedAt: null },
      select: { id: true },
    })
    return version?.id ?? null
  }

  private async resolveShareWriteSnapshotState(
    share: DrivePublicShareValue,
    actorUserId: string | null,
  ): Promise<{ readonly canWrite: boolean; readonly loginRequired: boolean }> {
    if (!actorUserId) {
      return {
        canWrite: false,
        loginRequired: share.accessMode !== DRIVE_SHARE_ACCESS_MODE.linkRead,
      }
    }
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { email: true },
    })
    if (!actor) return { canWrite: false, loginRequired: false }
    return {
      canWrite: canUserEditShare({
        accessMode: share.accessMode,
        actorUserId,
        actorEmail: actor.email,
        ownerId: share.ownerId,
        editorEmails: share.editorEmails,
      }),
      loginRequired: false,
    }
  }

  private async listActiveChildren(userId: string, parentId: string): Promise<DriveItemRecordWithStorage[]> {
    return this.prisma.driveItem.findMany({
      where: { userId, parentId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active, publicAsset: null },
      include: driveItemWithShares,
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    }) as Promise<DriveItemRecordWithStorage[]>
  }

  private async listActiveChildrenPage(
    userId: string,
    parentId: string | null,
    input?: DriveBrowserChildrenPageInput,
  ): Promise<DriveBrowserChildrenResult> {
    const pageInput = normalizeDriveBrowserChildrenPage(input)
    const children = await this.prisma.driveItem.findMany({
      where: { userId, parentId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active, publicAsset: null },
      include: driveItemWithShares,
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
      skip: pageInput.offset,
      take: pageInput.limit + 1,
    }) as DriveItemRecordWithStorage[]
    return {
      items: children.slice(0, pageInput.limit),
      page: buildDriveBrowserChildrenPage(pageInput, children.length),
    }
  }

  private async buildOwnedBrowserBreadcrumbs(
    userId: string,
    root: DriveItemRecordWithStorage,
    current: DriveItemRecordWithStorage,
    route: DriveBrowserRouteContext,
  ) {
    const items = await this.collectBrowserBreadcrumbItems({ userId, root, current })
    return items.map((item) => buildDriveBrowserBreadcrumb({ item: toDriveBrowserSourceItem(item), route }))
  }

  private async buildShareBrowserBreadcrumbs(
    userId: string,
    root: DriveItemRecordWithStorage,
    current: DriveItemRecordWithStorage,
    route: DriveBrowserRouteContext,
  ) {
    const items = await this.collectBrowserBreadcrumbItems({ userId, root, current })
    return items.map((item) => buildDriveBrowserBreadcrumb({ item: toDriveBrowserSourceItem(item), route }))
  }

  private async collectBrowserBreadcrumbItems(input: {
    readonly userId: string
    readonly root: DriveItemRecordWithStorage
    readonly current: DriveItemRecordWithStorage
  }): Promise<DriveItemRecordWithStorage[]> {
    const items: DriveItemRecordWithStorage[] = [input.current]
    let cursor = input.current
    while (cursor.id !== input.root.id) {
      if (!cursor.parentId) throw new NotFoundException("文件未找到")
      const parent = await this.findActiveDriveItem(input.userId, cursor.parentId)
      if (!parent) throw new NotFoundException("文件未找到")
      items.push(parent)
      cursor = parent
    }
    return items.reverse()
  }

  private async buildBrowserPreview(
    current: DriveItemRecordWithStorage,
    route: DriveBrowserRouteContext,
  ) {
    if (current.type === DRIVE_ITEM_TYPE.folder) return null
    const item = toDriveBrowserSourceItem(current)
    const kind = resolveDriveBrowserPreviewKind(item)
    const storageKey = this.requireActiveFileStorage(current)
    if (shouldReadDriveBrowserTextPreview(kind)) {
      if (kind === "markdown") {
        const preview = await this.readTextPreview(storageKey)
        const rendered = await renderDriveMarkdownFragment(preview.text)
        return buildDriveBrowserPreview({
          item,
          route,
          text: preview.text,
          html: rendered.html,
          outline: rendered.outline,
          truncated: preview.truncated,
        })
      }

      const preview = await this.readTextPreview(storageKey)
      return buildDriveBrowserPreview({ item, route, text: preview.text, html: null, truncated: preview.truncated })
    }
    if (shouldCreateDriveBrowserImagePreview(kind)) {
      const imageUrl = buildDriveBrowserItemDto({ item, route }).downloadUrl
      return buildDriveBrowserPreview({ item, route, imageUrl })
    }
    return buildDriveBrowserPreview({ item, route })
  }

  private async readTextPreview(storageKey: string): Promise<{ readonly text: string; readonly truncated: boolean }> {
    const object = await this.storage.getObjectStream({ key: storageKey })
    return readStreamTextPrefix(object.stream, DRIVE_BROWSER_TEXT_PREVIEW_MAX_BYTES)
  }

  private requireActiveFileStorage(item: DriveItemRecordWithStorage): string {
    if (item.type !== DRIVE_ITEM_TYPE.file || item.storageStatus !== DRIVE_STORAGE_STATUS.active || !item.storageKey) {
      throw new NotFoundException("文件未找到")
    }
    return item.storageKey
  }

  private assertActiveBrowserItem(item: DriveItemRecordWithStorage): void {
    if (item.storageStatus !== DRIVE_STORAGE_STATUS.active) throw new NotFoundException("文件未找到")
  }

  private async assertNoFolderCycle(itemId: string, parentId: string | null): Promise<void> {
    let currentParentId = parentId
    while (currentParentId) {
      if (currentParentId === itemId) throw new BadRequestException("不能移动到子文件夹。")
      const parent = await this.prisma.driveItem.findUnique({
        where: { id: currentParentId },
        select: { parentId: true },
      })
      currentParentId = parent?.parentId ?? null
    }
  }

  private async isDescendantOf(itemId: string, ancestorId: string): Promise<boolean> {
    let current = await this.prisma.driveItem.findUnique({
      where: { id: itemId },
      select: { parentId: true },
    })
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true
      current = await this.prisma.driveItem.findUnique({
        where: { id: current.parentId },
        select: { parentId: true },
      })
    }
    return false
  }

  private async failUploadSession(
    userId: string,
    sessionId: string,
    itemId: string,
    reservedBytes: bigint,
    status: string,
    now = new Date(),
    storageKey?: string,
  ): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.driveUploadSession.updateMany({
        where: { id: sessionId, userId, status: DRIVE_UPLOAD_STATUS.pending },
        data: { status, failedAt: now },
      })
      if (updated.count === 0) return { transitioned: false, overwrite: false }
      const item = await tx.driveItem.findUnique({
        where: { id: itemId },
        select: { storageKey: true, storageStatus: true },
      })
      const overwrite = Boolean(item && storageKey && item.storageStatus === DRIVE_STORAGE_STATUS.active && item.storageKey !== storageKey)
      if (!overwrite) {
        await tx.driveItem.update({
          where: { id: itemId },
          data: { storageStatus: DRIVE_STORAGE_STATUS.failed, uploadStatus: status },
        })
      }
      if (reservedBytes > 0n) {
        await tx.driveUsage.update({
          where: { userId },
          data: { reservedBytes: { decrement: reservedBytes } },
        })
      }
      return { transitioned: true, overwrite }
    })
    if (result.transitioned && storageKey) {
      if (result.overwrite) await this.deleteTemporaryUploadObject(storageKey)
      else await this.deleteStorageObject(itemId, storageKey)
    }
    return result.transitioned
  }

  private async rollbackFolderUploadPrepare(
    userId: string,
    rootItemId: string,
    preservedItemIds: ReadonlySet<string> = new Set(),
    preparedSessionIds: readonly string[] = [],
    now = new Date(),
  ): Promise<void> {
    const itemIds = await this.listDriveSubtreeItemIds(this.prisma, userId, rootItemId)
    const rollbackItemIds = itemIds.filter((itemId) => !preservedItemIds.has(itemId))
    if (rollbackItemIds.length === 0 && preparedSessionIds.length === 0) return

    await this.prisma.$transaction(async (tx) => {
      const pendingSessions = await tx.driveUploadSession.findMany({
        where: {
          userId,
          status: DRIVE_UPLOAD_STATUS.pending,
          OR: [
            ...(rollbackItemIds.length > 0 ? [{ itemId: { in: rollbackItemIds } }] : []),
            ...(preparedSessionIds.length > 0 ? [{ id: { in: [...preparedSessionIds] } }] : []),
          ],
        },
        select: { id: true, reservedBytes: true },
      })
      const pendingSessionIds = pendingSessions.map((session) => session.id)
      const reservedBytes = pendingSessions.reduce((sum, session) => sum + session.reservedBytes, 0n)

      if (pendingSessionIds.length > 0) {
        await tx.driveUploadSession.updateMany({
          where: { id: { in: pendingSessionIds }, userId, status: DRIVE_UPLOAD_STATUS.pending },
          data: { status: DRIVE_UPLOAD_STATUS.failed, failedAt: now },
        })
      }
      if (rollbackItemIds.length > 0) {
        await tx.driveItem.updateMany({
          where: { id: { in: rollbackItemIds }, userId, deletedAt: null },
          data: {
            deletedAt: now,
            storageStatus: DRIVE_STORAGE_STATUS.failed,
            uploadStatus: DRIVE_UPLOAD_STATUS.failed,
          },
        })
      }
      if (reservedBytes > 0n) {
        await tx.driveUsage.update({
          where: { userId },
          data: { reservedBytes: { decrement: reservedBytes } },
        })
      }
    })
  }

  private async listDriveSubtreeItemIds(prisma: DrivePrismaClient, userId: string, rootItemId: string): Promise<string[]> {
    const itemIds: string[] = []
    const queue = [rootItemId]

    while (queue.length > 0) {
      const itemId = queue.shift()!
      itemIds.push(itemId)
      const children = await prisma.driveItem.findMany({
        where: { userId, parentId: itemId },
        select: { id: true },
      })
      queue.push(...children.map((child) => child.id))
    }

    return itemIds
  }

  private async updateShareAccessSettings(
    shareId: string,
    material: DrivePasswordMaterial,
    accessMode: DriveShareAccessMode,
    editorEmails: readonly string[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.driveShareEditor.deleteMany({ where: { driveShareId: shareId } })
      return tx.driveShare.update({
        where: { id: shareId },
        data: {
          ...toDrivePasswordUpdateData(material),
          accessMode,
          ...(editorEmails.length > 0
            ? { editors: { create: editorEmails.map((email) => ({ email })) } }
            : {}),
        },
        include: driveShareWithEditors,
      })
    })
  }

  private async createUniqueShare(
    itemId: string,
    userId: string,
    type: string,
    material: DrivePasswordMaterial,
    accessMode: DriveShareAccessMode,
    editorEmails: readonly string[],
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.driveShare.create({
          data: {
            itemId,
            userId,
            type,
            shareId: createDriveShareId(),
            ...toDrivePasswordUpdateData(material),
            accessMode,
            ...(editorEmails.length > 0
              ? { editors: { create: editorEmails.map((email) => ({ email })) } }
              : {}),
          },
          include: driveShareWithEditors,
        })
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const racedShare = await this.prisma.driveShare.findFirst({
          where: { itemId, userId, enabled: true },
          include: driveShareWithEditors,
        })
        if (racedShare) {
          return this.updateShareAccessSettings(racedShare.id, material, accessMode, editorEmails)
        }
      }
    }
    throw new Error("Unable to create unique drive share id.")
  }

  private async recordDriveAudit(input: {
    readonly userId: string
    readonly action: string
    readonly targetType: string
    readonly targetId: string
    readonly detail: Record<string, unknown>
    readonly ipAddress?: string
  }): Promise<void> {
    try {
      const actorEmail = await this.resolveDriveAuditActorEmail(input.userId)
      await this.auditLog?.record({
        adminEmail: actorEmail,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: redactDriveAuditDetail(input.detail),
        ipAddress: input.ipAddress ?? "system",
      })
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      }, "Drive audit log write failed")
    }
  }

  private async resolveDriveAuditActorEmail(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    return user?.email ?? userId
  }

  private async *createFolderZipEntries(userId: string, folderId: string): AsyncIterable<DriveFolderZipEntry> {
    const usedPaths = new Set<string>()
    const queue: Array<{ readonly parentId: string; readonly prefix: string }> = [{ parentId: folderId, prefix: "" }]

    while (queue.length > 0) {
      const current = queue.shift()!
      const children = await this.listActiveChildren(userId, current.parentId)
      for (const child of children) {
        const childPath = current.prefix ? `${current.prefix}/${child.name}` : child.name
        if (child.type === DRIVE_ITEM_TYPE.folder) {
          queue.push({ parentId: child.id, prefix: childPath })
          continue
        }
        if (!child.storageKey) continue
        yield { path: createUniqueDriveZipEntryPath(childPath, usedPaths), storageKey: child.storageKey }
      }
    }
  }

  private decryptStoredPassword(value: string | null | undefined): string | null {
    if (!value) return null
    return decryptDrivePassword(value, this.accessSecret)
  }

  private async deleteItemInternal(input: {
    readonly itemId: string
    readonly userId?: string
    readonly actorEmail: string
    readonly ipAddress: string
    readonly admin: boolean
  }): Promise<void> {
    const root = input.userId
      ? await this.requireOwnedItem(input.userId, input.itemId)
      : await this.prisma.driveItem.findFirst({ where: { id: input.itemId, deletedAt: null }, include: driveItemWithShares })
    if (!root) throw new NotFoundException("文件不存在。")
    const items = await this.collectSubtree(root.id)
    const itemIds = items.map((item) => item.id)
    const activeFiles = items.filter((item) => item.type === DRIVE_ITEM_TYPE.file && item.storageKey && item.storageStatus === DRIVE_STORAGE_STATUS.active)
    const deletedAt = new Date()
    let cancelledUploadSessions = 0
    let releasedReservedBytes = 0n
    let pendingUploadCleanup: Array<{ readonly itemId: string; readonly storageKey: string }> = []
    await this.prisma.$transaction(async (tx) => {
      const pendingUploadSessions = await tx.driveUploadSession.findMany({
        where: { userId: root.userId, itemId: { in: itemIds }, status: DRIVE_UPLOAD_STATUS.pending },
        select: { id: true, itemId: true, storageKey: true, reservedBytes: true },
      })
      const pendingSessionIds = pendingUploadSessions.map((session) => session.id)
      const pendingItemIds = pendingUploadSessions.map((session) => session.itemId)
      const pendingReservedBytes = pendingUploadSessions.reduce((sum, session) => sum + session.reservedBytes, 0n)

      await tx.driveShare.updateMany({
        where: { itemId: { in: itemIds } },
        data: { enabled: false, disabledAt: deletedAt },
      })
      if (pendingSessionIds.length > 0) {
        await tx.driveUploadSession.updateMany({
          where: { id: { in: pendingSessionIds }, userId: root.userId, status: DRIVE_UPLOAD_STATUS.pending },
          data: { status: DRIVE_UPLOAD_STATUS.cancelled, failedAt: deletedAt },
        })
      }
      await tx.driveItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          deletedAt,
          storageStatus: DRIVE_STORAGE_STATUS.deleted,
          uploadStatus: DRIVE_UPLOAD_STATUS.completed,
        },
      })
      if (pendingItemIds.length > 0) {
        await tx.driveItem.updateMany({
          where: { id: { in: pendingItemIds } },
          data: { uploadStatus: DRIVE_UPLOAD_STATUS.cancelled },
        })
      }
      const usageDelta = activeFiles.reduce((sum, item) => sum + item.size, 0n)
      if (usageDelta > 0n) {
        await tx.driveUsage.update({
          where: { userId: root.userId },
          data: { usedBytes: { decrement: usageDelta } },
        })
      }
      if (pendingReservedBytes > 0n) {
        await tx.driveUsage.update({
          where: { userId: root.userId },
          data: { reservedBytes: { decrement: pendingReservedBytes } },
        })
      }
      cancelledUploadSessions = pendingUploadSessions.length
      releasedReservedBytes = pendingReservedBytes
      pendingUploadCleanup = pendingUploadSessions.map((session) => ({
        itemId: session.itemId,
        storageKey: session.storageKey,
      }))
    })
    await this.recordDriveDeleteAuditSafely({
      adminEmail: input.actorEmail,
      action: input.admin ? "admin.drive.delete" : "drive.delete",
      targetType: "drive_item",
      targetId: root.id,
      detail: {
        count: itemIds.length,
        cancelledUploadSessions,
        releasedReservedBytes: releasedReservedBytes.toString(),
      },
      ipAddress: input.ipAddress,
    })
    for (const file of activeFiles) {
      await this.deleteStorageObject(file.id, file.storageKey!)
    }
    for (const session of pendingUploadCleanup) {
      await this.deleteStorageObject(session.itemId, session.storageKey)
    }
  }

  private async collectSubtree(rootId: string) {
    const result = []
    const queue = [rootId]
    while (queue.length > 0) {
      const ids = queue.splice(0, queue.length)
      const batch = await this.prisma.driveItem.findMany({
        where: { id: { in: ids }, deletedAt: null },
      })
      result.push(...batch)
      const children = await this.prisma.driveItem.findMany({
        where: { parentId: { in: ids }, deletedAt: null },
        select: { id: true },
      })
      queue.push(...children.map((child) => child.id))
    }
    return result
  }

  private async deleteStorageObject(itemId: string, storageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey)
    } catch (error) {
      this.logger.warn({
        itemId,
        storageKeyLength: storageKey.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Drive storage object delete failed")
      await this.prisma.driveItem.update({
        where: { id: itemId },
        data: {
          storageDeletePending: true,
          storageStatus: DRIVE_STORAGE_STATUS.deletePending,
        },
      })
    }
  }

  private async deleteTemporaryUploadObject(storageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey)
    } catch (error) {
      this.logger.warn({
        storageKeyLength: storageKey.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Drive temporary upload object delete failed")
    }
  }

  private async cleanupFileVersionsAfterChange(userId: string, itemId: string): Promise<void> {
    const item = await this.prisma.driveItem.findFirst({
      where: { id: itemId, userId, deletedAt: null, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active },
      select: { id: true, storageKey: true },
    })
    if (!item) return
    const candidates = await this.prisma.$transaction(async (tx) => {
      const rows = await listCleanupCandidateVersions(tx, {
        itemId: item.id,
        currentStorageKey: item.storageKey,
        now: new Date(),
      })
      if (rows.length === 0) return rows
      await tx.driveFileVersion.updateMany({
        where: { id: { in: rows.map((version) => version.id) } },
        data: { deletedAt: new Date(), deletePending: false },
      })
      const releasedBytes = rows.reduce((sum, version) => sum + version.size, 0n)
      if (releasedBytes > 0n) {
        await tx.driveUsage.update({
          where: { userId },
          data: { usedBytes: { decrement: releasedBytes } },
        })
      }
      return rows
    })
    for (const version of candidates) {
      try {
        await this.storage.deleteObject(version.storageKey)
      } catch (error) {
        await this.prisma.driveFileVersion.update({
          where: { id: version.id },
          data: { deletePending: true },
        })
        this.logger.warn({
          itemId,
          versionId: version.id,
          storageKeyLength: version.storageKey.length,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: formatAuditError(error),
        }, "Drive file version cleanup delete failed")
      }
    }
  }

  private async recordDriveDeleteAuditSafely(input: Parameters<AuditLogService["record"]>[0]): Promise<void> {
    try {
      await this.auditLog?.record(input)
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Failed to record drive delete audit log")
    }
  }

  private getLifecycleService(): DriveLifecycleService {
    return this.lifecycle ?? new DriveLifecycleService(this.prisma, this.storage, this.auditLog, this.changes)
  }

  private async recordDriveChange(input: DriveChangeAppendInput, client?: DrivePrismaClient): Promise<void> {
    if (!this.changes) return
    if (client) {
      await this.changes.append(input, client)
      return
    }
    await this.changes.append(input)
  }
}

function redactDriveAuditDetail(value: Record<string, unknown>): Record<string, unknown> {
  return redactDriveAuditValue(value) as Record<string, unknown>
}

function redactDriveAuditValue(value: unknown): unknown {
  if (typeof value === "string") {
    return isPublicDriveShareId(value) ? "[redacted-share-id]" : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDriveAuditValue(item))
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
    key,
    key === "shareId" || key === "requestedShareId"
      ? redactDriveAuditShareValue(entryValue)
      : redactDriveAuditValue(entryValue),
  ]))
}

function redactDriveAuditShareValue(value: unknown): unknown {
  return typeof value === "string" ? "[redacted-share-id]" : redactDriveAuditValue(value)
}

function isPublicDriveShareId(value: string): boolean {
  return /^shr_[A-Za-z0-9]+$/u.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]"
}

async function ensureUsage(client: DrivePrismaClient, userId: string) {
  return ensureDriveUsage(client, userId)
}

function isOverwriteUploadSession(session: {
  readonly storageKey: string
  readonly item: { readonly storageKey: string | null; readonly storageStatus: string }
}): boolean {
  return session.item.storageStatus === DRIVE_STORAGE_STATUS.active && session.item.storageKey !== null && session.item.storageKey !== session.storageKey
}

function versionFileName(name: string, versionNumber: number): string {
  return `v${versionNumber}-${name}`
}

async function updateDriveUsageAfterUploadCompletion(
  client: DrivePrismaClient,
  userId: string,
  input: { readonly reservedBytes: bigint; readonly usedBytesDelta: bigint },
): Promise<void> {
  const data: Prisma.DriveUsageUpdateInput = {}
  if (input.reservedBytes > 0n) data.reservedBytes = { decrement: input.reservedBytes }
  if (input.usedBytesDelta > 0n) data.usedBytes = { increment: input.usedBytesDelta }
  if (input.usedBytesDelta < 0n) data.usedBytes = { decrement: -input.usedBytesDelta }
  if (Object.keys(data).length === 0) return
  await client.driveUsage.update({ where: { userId }, data })
}

function normalizeDriveName(value: string): string {
  const name = value.normalize("NFC")
  if (!isValidDriveItemName(name)) throw new BadRequestException("文件名无效。")
  return name
}

function normalizeDriveFolderPathSegments(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequestException("文件夹路径不能为空。")
  return value.map(normalizeDriveName)
}

function normalizeDriveItemTreePage(input: DriveItemTreeListInput): { readonly offset: number; readonly limit: number } {
  const offset = typeof input.offset === "number" && Number.isFinite(input.offset) && input.offset > 0
    ? Math.floor(input.offset)
    : 0
  const requestedLimit = typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
    ? Math.floor(input.limit)
    : DRIVE_ITEM_TREE_DEFAULT_LIMIT
  return {
    offset,
    limit: Math.min(requestedLimit, DRIVE_ITEM_TREE_MAX_LIMIT),
  }
}

function summarizeReorganizationMoves(
  moves: readonly DriveReorganizationPlannedMoveDto[],
): DriveReorganizationAppliedMoveDto[] {
  return moves.slice(0, DRIVE_REORGANIZATION_AUDIT_MOVE_LIMIT).map((move) => ({
    itemId: move.itemId,
    fromParentId: move.fromParentId,
    targetParentId: move.targetParentId,
  }))
}

function buildDriveItemTreeEntries(items: readonly DriveItemDto[], parentId: string | null): DriveItemTreeEntryDto[] {
  const childrenByParent = new Map<string | null, DriveItemDto[]>()
  const itemById = new Map(items.map((item) => [item.id, item]))
  for (const item of items) {
    const children = childrenByParent.get(item.parentId) ?? []
    children.push(item)
    childrenByParent.set(item.parentId, children)
  }

  const entries: DriveItemTreeEntryDto[] = []

  const findPath = (itemId: string): string => {
    const chain: string[] = []
    let current = itemById.get(itemId)
    while (current) {
      chain.unshift(current.name)
      current = current.parentId ? itemById.get(current.parentId) : undefined
    }
    return chain.join("/")
  }

  const walk = (currentParentId: string | null, prefix: string, depth: number) => {
    for (const child of childrenByParent.get(currentParentId) ?? []) {
      const path = prefix ? `${prefix}/${child.name}` : child.name
      entries.push({ ...child, path, depth })
      if (child.type === "folder") walk(child.id, path, depth + 1)
    }
  }

  if (parentId) {
    walk(parentId, findPath(parentId), 1)
  } else {
    walk(null, "", 0)
  }
  return entries
}

function numericCount(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value
}

function isDriveItemTreeEntryQueryRow(row: DriveItemTreeQueryRow): row is DriveItemTreeEntryQueryRow {
  return row.id !== null
    && row.type !== null
    && row.name !== null
    && row.size !== null
    && row.storageStatus !== null
    && row.createdAt !== null
    && row.updatedAt !== null
    && row.path !== null
    && row.depth !== null
}

function ordinaryDriveItemWhere(input: {
  readonly userId: string
  readonly id?: string
  readonly parentId?: string | null
  readonly type?: string
}): Prisma.DriveItemWhereInput {
  return {
    userId: input.userId,
    ...(input.id ? { id: input.id } : {}),
    ...("parentId" in input ? { parentId: input.parentId ?? null } : {}),
    ...(input.type ? { type: input.type } : {}),
    deletedAt: null,
    lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
    publicAsset: null,
    NOT: {
      uploadSessions: {
        some: {
          purpose: DRIVE_UPLOAD_PURPOSE.publicAssetUpload,
          status: DRIVE_UPLOAD_STATUS.pending,
        },
      },
    },
  }
}

function toDriveItemTreeEntryDto(row: DriveItemTreeEntryQueryRow): DriveItemTreeEntryDto {
  return {
    ...toDriveItemDto({
      id: row.id,
      parentId: row.parentId,
      type: row.type,
      name: row.name,
      size: row.size,
      mimeType: row.mimeType,
      storageStatus: row.storageStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      shares: row.activeShareId ? [{ id: row.activeShareId, enabled: true }] : [],
    }),
    path: row.path,
    depth: row.depth,
  }
}

function parseRequestedSize(value: string): bigint {
  if (!/^\d+$/u.test(value)) throw new BadRequestException("文件大小无效。")
  const size = BigInt(value)
  if (size <= 0n) throw new BadRequestException("文件大小无效。")
  return size
}

function normalizeRelativePath(value: string): string[] {
  const parts = value
    .split(/[\\/]+/u)
    .map((part) => normalizeDriveName(part))
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new BadRequestException("文件路径无效。")
  }
  return parts
}

function isHtmlDriveItem(name: string, mimeType: string | null): boolean {
  const lowerName = name.toLowerCase()
  return lowerName.endsWith(".html") || lowerName.endsWith(".htm") || mimeType === "text/html"
}

function isMarkdownDriveItem(name: string, mimeType: string | null): boolean {
  const lowerName = name.toLowerCase()
  const normalizedMimeType = mimeType?.toLowerCase() ?? ""
  return lowerName.endsWith(".md")
    || lowerName.endsWith(".markdown")
    || normalizedMimeType === "text/markdown"
    || normalizedMimeType === "text/x-markdown"
}

function toDrivePublicShareValue(share: {
  readonly id: string
  readonly shareId: string
  readonly accessMode: string
  readonly editors?: readonly { readonly email: string }[]
  readonly item: Parameters<typeof toDriveItemDto>[0] & {
    readonly userId: string
    readonly storageKey: string | null
  }
}): DrivePublicShareValue {
  return {
    id: share.id,
    shareId: share.shareId,
    item: toDriveItemDto(share.item),
    ownerId: share.item.userId,
    storageKey: share.item.storageKey,
    type: share.item.type === DRIVE_ITEM_TYPE.folder ? "folder" : "file",
    accessMode: normalizeDriveShareAccessMode(share.accessMode),
    editorEmails: share.editors?.map((editor) => editor.email) ?? [],
  }
}

function toDriveBrowserSourceItem(item: DriveItemRecord): DriveBrowserSourceItem {
  const dto = toDriveItemDto(item)
  return {
    id: dto.id,
    name: dto.name,
    type: dto.type,
    size: dto.size,
    mimeType: dto.mimeType,
    updatedAt: dto.updatedAt,
  }
}

async function readStreamTextPrefix(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<{ readonly text: string; readonly truncated: boolean }> {
  const chunks: Buffer[] = []
  let bytes = 0
  let truncated = false
  const readable = stream as NodeJS.ReadableStream & AsyncIterable<Buffer | string>

  for await (const chunk of readable) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const available = maxBytes - bytes
    if (buffer.length > available) {
      if (available > 0) chunks.push(buffer.subarray(0, available))
      bytes = maxBytes
      truncated = true
      const destroyable = stream as { destroy?: () => void }
      destroyable.destroy?.()
      break
    }
    chunks.push(buffer)
    bytes += buffer.length
  }

  return { text: Buffer.concat(chunks, bytes).toString("utf8"), truncated }
}

function toDriveShareDto(
  share: {
    id: string
    shareId: string
    itemId: string
    enabled: boolean
    passwordEnabled?: boolean
    expiresAt?: Date | null
    accessMode?: string
    editors?: readonly { readonly email: string }[]
    createdAt: Date
  },
  publicAppUrl: string,
  password: string | null = null,
): DriveShareDto {
  const url = buildDriveShareUrl({ publicAppUrl, shareId: share.shareId })
  const passwordEnabled = share.passwordEnabled ?? false
  return {
    id: share.id,
    shareId: share.shareId,
    itemId: share.itemId,
    enabled: share.enabled,
    url,
    urlWithPassword: buildDriveUrlWithPassword(url, passwordEnabled ? password : null),
    passwordEnabled,
    password: passwordEnabled ? password : null,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    accessMode: normalizeDriveShareAccessMode(share.accessMode),
    editorEmails: share.editors?.map((editor) => editor.email) ?? [],
    createdAt: share.createdAt.toISOString(),
  }
}

function toDrivePasswordUpdateData(material: DrivePasswordMaterial, appliedAt = new Date()) {
  return {
    passwordEnabled: material.passwordEnabled,
    passwordHash: material.passwordHash,
    passwordEncrypted: material.passwordEncrypted,
    expiresAt: material.expiresAt,
    accessSettingsAppliedAt: appliedAt,
  }
}

function buildAdminWhere(filters: DriveAdminFilters): Prisma.DriveItemWhereInput {
  const where: Prisma.DriveItemWhereInput = {
    OR: [
      { deletedAt: null },
      { storageDeletePending: true, storageStatus: DRIVE_STORAGE_STATUS.deletePending },
    ],
  }
  if (filters.userId) where.userId = filters.userId
  if (filters.type) where.type = filters.type
  if (filters.storageStatus) where.storageStatus = filters.storageStatus
  if (filters.shared === "true") where.shares = { some: { enabled: true } }
  if (filters.shared === "false") where.shares = { none: { enabled: true } }
  if (filters.search) {
    where.AND = [
      {
        OR: [
          { id: { contains: filters.search, mode: "insensitive" } },
          { name: { contains: filters.search, mode: "insensitive" } },
        ],
      },
    ]
  }
  return where
}

function buildAdminStorageBucket(
  rows: readonly {
    readonly lifecycleStatus: string
    readonly _count: { readonly _all: number }
    readonly _sum: { readonly size: bigint | null }
  }[],
): DriveAdminStorageSummaryDto["normalDrive"] {
  const bucket = {
    active: { count: 0, bytes: 0n },
    trashed: { count: 0, bytes: 0n },
    hidden: { count: 0, bytes: 0n },
  }
  for (const row of rows) {
    if (row.lifecycleStatus === DRIVE_ITEM_LIFECYCLE_STATUS.active) {
      bucket.active.count += row._count._all
      bucket.active.bytes += row._sum.size ?? 0n
      continue
    }
    if (row.lifecycleStatus === DRIVE_ITEM_LIFECYCLE_STATUS.trashed) {
      bucket.trashed.count += row._count._all
      bucket.trashed.bytes += row._sum.size ?? 0n
      continue
    }
    if (row.lifecycleStatus === DRIVE_ITEM_LIFECYCLE_STATUS.hidden) {
      bucket.hidden.count += row._count._all
      bucket.hidden.bytes += row._sum.size ?? 0n
    }
  }
  return {
    active: { count: bucket.active.count, bytes: bucket.active.bytes.toString() },
    trashed: { count: bucket.trashed.count, bytes: bucket.trashed.bytes.toString() },
    hidden: { count: bucket.hidden.count, bytes: bucket.hidden.bytes.toString() },
  }
}

function bucketQuotaBytes(bucket: DriveAdminStorageSummaryDto["normalDrive"]): bigint {
  return BigInt(bucket.active.bytes) + BigInt(bucket.trashed.bytes)
}

function createUniqueDriveZipEntryPath(path: string, usedPaths: Set<string>): string {
  const firstKey = driveZipEntryPathKey(path)
  if (!usedPaths.has(firstKey)) {
    usedPaths.add(firstKey)
    return path
  }

  const slashIndex = path.lastIndexOf("/")
  const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : ""
  const filename = slashIndex >= 0 ? path.slice(slashIndex + 1) : path
  const extensionIndex = filename.lastIndexOf(".")
  const hasExtension = extensionIndex > 0
  const baseName = hasExtension ? filename.slice(0, extensionIndex) : filename
  const extension = hasExtension ? filename.slice(extensionIndex) : ""

  for (let index = 2; ; index += 1) {
    const candidate = `${directory}${baseName} (${index})${extension}`
    const candidateKey = driveZipEntryPathKey(candidate)
    if (!usedPaths.has(candidateKey)) {
      usedPaths.add(candidateKey)
      return candidate
    }
  }
}

function driveZipEntryPathKey(path: string): string {
  return path.toLowerCase()
}

function normalizeDriveBrowserChildrenPage(input?: DriveBrowserChildrenPageInput): { readonly offset: number; readonly limit: number } {
  const requestedOffset = input?.offset
  const requestedLimit = input?.limit
  const offset = typeof requestedOffset === "number" && Number.isFinite(requestedOffset) && requestedOffset > 0
    ? Math.floor(requestedOffset)
    : 0
  const rawLimit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : DRIVE_BROWSER_CHILDREN_DEFAULT_LIMIT
  return {
    offset,
    limit: Math.min(rawLimit, DRIVE_BROWSER_CHILDREN_MAX_LIMIT),
  }
}

function normalizeDrivePublicLinksPage(input?: DrivePublicLinksPageInput): { readonly offset: number; readonly limit: number; readonly search?: string } {
  const requestedOffset = input?.offset
  const requestedLimit = input?.limit
  const search = input?.search?.trim()
  const offset = typeof requestedOffset === "number" && Number.isFinite(requestedOffset) && requestedOffset > 0
    ? Math.floor(requestedOffset)
    : 0
  const rawLimit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : 20
  return {
    offset,
    limit: Math.min(rawLimit, 100),
    ...(search ? { search } : {}),
  }
}

function buildDriveBrowserChildrenPage(
  input: { readonly offset: number; readonly limit: number },
  fetchedCount: number,
): DriveBrowserChildrenPageDto {
  const hasMore = fetchedCount > input.limit
  return {
    offset: input.offset,
    limit: input.limit,
    hasMore,
    nextOffset: hasMore ? input.offset + input.limit : null,
  }
}

function buildDriveBrowserAnnotationCapability(input: {
  readonly item: { readonly name: string; readonly type: string; readonly mimeType: string | null }
  readonly canComment: boolean
  readonly reason?: DriveBrowserAnnotationCapabilityDto["reason"]
}): DriveBrowserAnnotationCapabilityDto | null {
  if (!isCommentableMarkdownItem(input.item)) return null
  return {
    canComment: input.canComment,
    reason: input.canComment ? null : input.reason ?? "permission_denied",
  }
}

function buildDrivePublicLinksPage(
  input: { readonly offset: number; readonly limit: number },
  fetchedCount: number,
): DriveBrowserChildrenPageDto {
  return buildDriveBrowserChildrenPage(input, fetchedCount)
}

function emptyDriveBrowserChildrenPage(input?: DriveBrowserChildrenPageInput): DriveBrowserChildrenResult {
  const pageInput = normalizeDriveBrowserChildrenPage(input)
  return {
    items: [],
    page: buildDriveBrowserChildrenPage(pageInput, 0),
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function readUserAccessJwtSecret(source: NodeJS.ProcessEnv): string {
  const secret = source.USER_ACCESS_JWT_SECRET
  if (!secret || secret.length < 32) throw new Error("服务端环境变量无效：USER_ACCESS_JWT_SECRET")
  return secret
}
