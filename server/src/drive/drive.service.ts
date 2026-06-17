import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, Optional } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import {
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
  type DriveItemDto,
  type DriveItemTreeEntryDto,
  type DriveItemTreeListInput,
  type DriveItemTreeListPageDto,
  type DriveReorganizationApplyInput,
  type DriveReorganizationApplyResultDto,
  type DriveReorganizationPlannedMoveDto,
  type DriveReorganizationPreviewDto,
  type DriveReorganizationPreviewInput,
  type DriveStatsDto,
  type DriveShareDto,
  type DriveShareListPageDto,
  type DriveShareListItemDto,
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
  DRIVE_ITEM_TYPE,
  DRIVE_STORAGE_STATUS,
  DRIVE_UPLOAD_STATUS,
  driveDefaultQuotaBytes,
  driveMaxFileBytes,
  driveUploadUrlTtlSeconds,
} from "./drive.constants"
import {
  createDriveShareId,
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
import {
  toDriveItemDto,
  type DriveAdminFilters,
  type DriveAdminItemDto,
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

type DrivePublicAccessResult<T> =
  | { readonly status: "ok"; readonly value: T; readonly cookie?: string }
  | { readonly status: "password_required" }

type DrivePublicShareValue = {
  readonly item: DriveItemDto
  readonly ownerId: string
  readonly storageKey: string | null
  readonly type: "file" | "folder"
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
  readonly entries: readonly DriveFolderZipEntry[]
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
    select: { id: true, enabled: true },
  },
} as const

const DRIVE_BROWSER_CHILDREN_DEFAULT_LIMIT = 100
const DRIVE_BROWSER_CHILDREN_MAX_LIMIT = 200
const DRIVE_ITEM_TREE_DEFAULT_LIMIT = 500
const DRIVE_ITEM_TREE_MAX_LIMIT = 2000
const DRIVE_REORGANIZATION_PLAN_TTL_MS = 5 * 60 * 1000

@Injectable()
export class DriveService implements OnApplicationBootstrap {
  private readonly accessSecret = readUserAccessJwtSecret(process.env)
  private readonly logger = new Logger(DriveService.name)
  private readonly reorganizationPlans = new Map<string, DriveReorganizationPlan>()

  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.backfillLegacyDriveAccessProtection()
  }

  async listItems(userId: string, parentId: string | null): Promise<DriveItemDto[]> {
    if (parentId) await this.requireOwnedFolder(userId, parentId)
    const items = await this.prisma.driveItem.findMany({
      where: { userId, parentId, deletedAt: null },
      include: driveItemWithShares,
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    })
    return items.map(toDriveItemDto)
  }

  async getItem(userId: string, itemId: string): Promise<DriveItemDto> {
    return toDriveItemDto(await this.requireOwnedItem(userId, itemId))
  }

  async prepareUpload(userId: string, input: DrivePrepareUploadInput): Promise<DriveUploadPrepareResult> {
    const name = normalizeDriveName(input.name)
    const requestedSize = parseRequestedSize(input.size)
    if (requestedSize > driveMaxFileBytes) throw new BadRequestException(`文件超过 ${DRIVE_MAX_FILE_SIZE_LABEL} 限制。`)
    if (input.parentId) await this.requireOwnedFolder(userId, input.parentId)

    const result = await this.prisma.$transaction(async (tx) => {
      const usage = await ensureUsage(tx, userId)
      if (usage.usedBytes + usage.reservedBytes + requestedSize > usage.quotaBytes) {
        throw new BadRequestException("云盘空间不足。")
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
          status: DRIVE_UPLOAD_STATUS.pending,
          credentialKind: "presigned_put",
          expiresAt: new Date(Date.now() + driveUploadUrlTtlSeconds * 1000),
        },
      })
      await tx.driveUsage.update({
        where: { userId },
        data: { reservedBytes: { increment: requestedSize } },
      })
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
      await this.failUploadSession(userId, result.session.id, result.session.itemId, result.session.expectedSize, DRIVE_UPLOAD_STATUS.failed)
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
    let root: DriveItemDto | null = null
    const entries: DriveFolderUploadPrepareResult["entries"] = []

    try {
      root = await this.createFolder(userId, { parentId: input.parentId, name: input.folderName }, auditContext)
      const folderIdsByPath = new Map<string, string>([["", root.id]])

      for (const file of input.files) {
        const parts = normalizeRelativePath(file.relativePath)
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
          const folder = await this.createFolder(userId, { parentId, name: folderName }, auditContext)
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
        entries.push({ relativePath: parts.join("/"), ...prepared })
      }

      return { root, entries }
    } catch (error) {
      if (root) await this.rollbackFolderUploadPrepare(userId, root.id)
      throw error
    }
  }

  async completeUpload(userId: string, sessionId: string, auditContext: DriveAuditContext = {}): Promise<DriveItemDto> {
    const session = await this.prisma.driveUploadSession.findFirst({
      where: { id: sessionId, userId },
      include: { item: { include: driveItemWithShares } },
    })
    if (!session || session.item.deletedAt) throw new NotFoundException("上传会话不存在。")
    if (session.status === DRIVE_UPLOAD_STATUS.completed) {
      return toDriveItemDto(session.item)
    }
    if (session.status !== DRIVE_UPLOAD_STATUS.pending) throw new NotFoundException("上传会话不存在。")
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.failUploadSession(userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.expired, new Date(), session.storageKey)
      throw new BadRequestException("上传会话已过期。")
    }
    const object = await this.storage.headObject(session.storageKey)
    if (!object || object.size !== session.expectedSize) {
      await this.failUploadSession(userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.failed, new Date(), session.storageKey)
      throw new BadRequestException("上传文件校验失败。")
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.driveUploadSession.updateMany({
        where: { id: session.id, userId, status: DRIVE_UPLOAD_STATUS.pending },
        data: { status: DRIVE_UPLOAD_STATUS.completed, completedAt: new Date() },
      })
      if (transitioned.count === 0) {
        const current = await tx.driveUploadSession.findFirst({
          where: { id: session.id, userId, status: DRIVE_UPLOAD_STATUS.completed },
          include: { item: { include: driveItemWithShares } },
        })
        if (!current || current.item.deletedAt) throw new NotFoundException("上传会话不存在。")
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
      await tx.driveUsage.update({
        where: { userId },
        data: {
          reservedBytes: { decrement: session.expectedSize },
          usedBytes: { increment: session.expectedSize },
        },
      })
      const item = await tx.driveItem.update({
        where: { id: session.itemId },
        data: {
          storageStatus: DRIVE_STORAGE_STATUS.active,
          uploadStatus: DRIVE_UPLOAD_STATUS.completed,
        },
        include: driveItemWithShares,
      })
      return { item, completedNow: true }
    })
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
    const transitioned = await this.failUploadSession(userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.cancelled, new Date(), session.storageKey)
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
      where: { userId, parentId: input.parentId, name, type: DRIVE_ITEM_TYPE.folder, deletedAt: null },
      select: { id: true },
    })
    if (existingFolder) throw new BadRequestException("同名文件夹已存在。")
    const folder = await this.prisma.driveItem.create({
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

  async renameItem(userId: string, itemId: string, name: string, auditContext: DriveAuditContext = {}): Promise<DriveItemDto> {
    const item = await this.requireOwnedItem(userId, itemId)
    const nextName = normalizeDriveName(name)
    if (item.type === DRIVE_ITEM_TYPE.folder) {
      const duplicate = await this.prisma.driveItem.findFirst({
        where: { userId, parentId: item.parentId, name: nextName, type: DRIVE_ITEM_TYPE.folder, deletedAt: null, id: { not: item.id } },
        select: { id: true },
      })
      if (duplicate) throw new BadRequestException("同名文件夹已存在。")
    }
    const updated = await this.prisma.driveItem.update({
      where: { id: itemId },
      data: { name: nextName },
      include: driveItemWithShares,
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
      const duplicate = await this.prisma.driveItem.findFirst({
        where: { userId, parentId, name: item.name, type: DRIVE_ITEM_TYPE.folder, deletedAt: null, id: { not: item.id } },
        select: { id: true },
      })
      if (duplicate) throw new BadRequestException("目标位置已有同名文件夹。")
    }
    const updated = await this.prisma.driveItem.update({
      where: { id: item.id },
      data: { parentId },
      include: driveItemWithShares,
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

  async deleteItem(
    userId: string,
    itemId: string,
    actorEmail = userId,
    ipAddress = "system",
  ): Promise<{ readonly ok: true }> {
    const resolvedActorEmail = actorEmail === userId
      ? await this.resolveDriveAuditActorEmail(userId)
      : actorEmail
    await this.deleteItemInternal({
      itemId,
      userId,
      actorEmail: resolvedActorEmail,
      ipAddress,
      admin: false,
    })
    return { ok: true }
  }

  async createShare(
    userId: string,
    itemId: string,
    publicAppUrl: string,
    settings: DriveAccessSettingsInput = DRIVE_DEFAULT_ACCESS_SETTINGS,
    auditContext: DriveAuditContext = {},
  ): Promise<DriveShareDto> {
    const item = await this.requireOwnedItem(userId, itemId)
    if (item.storageStatus !== DRIVE_STORAGE_STATUS.active) {
      throw new BadRequestException("文件尚不可分享。")
    }
    const material = await createDrivePasswordMaterial(settings, this.accessSecret)
    const existing = await this.prisma.driveShare.findFirst({
      where: { itemId: item.id, userId, enabled: true },
    })
    const share = existing
      ? await this.prisma.driveShare.update({
        where: { id: existing.id },
        data: toDrivePasswordUpdateData(material),
      })
      : await this.createUniqueShare(item.id, userId, item.type, material)
    const dto = toDriveShareDto(share, publicAppUrl, material.password)
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
      },
      ipAddress: auditContext.ipAddress,
    })
    return dto
  }

  async disableShare(userId: string, shareId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const result = await this.prisma.driveShare.updateMany({
      where: { id: shareId, userId, enabled: true },
      data: { enabled: false, disabledAt: new Date() },
    })
    if (result.count === 0) throw new NotFoundException("分享不存在。")
    await this.recordDriveAudit({
      userId,
      action: "drive.share.disable",
      targetType: "drive.share",
      targetId: shareId,
      detail: { userId, shareRecordId: shareId, disabledCount: result.count },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true }
  }

  async listShares(userId: string, publicAppUrl: string, page?: DrivePublicLinksPageInput): Promise<DriveShareListPageDto> {
    const pageInput = normalizeDrivePublicLinksPage(page)
    const shares = await this.prisma.driveShare.findMany({
      where: { userId, enabled: true },
      include: { item: { select: { id: true, name: true, type: true, deletedAt: true } } },
      orderBy: { createdAt: "desc" },
      skip: pageInput.offset,
      take: pageInput.limit + 1,
    })
    const items: DriveShareListItemDto[] = shares.slice(0, pageInput.limit).map((share) => {
      const url = buildDriveShareUrl({ publicAppUrl, shareId: share.shareId })
      const password = share.passwordEnabled ? this.decryptStoredPassword(share.passwordEncrypted) : null
      return {
        id: share.id,
        shareId: share.shareId,
        itemId: share.itemId,
        itemName: share.item.name,
        itemType: share.item.type === DRIVE_ITEM_TYPE.folder ? "folder" : "file",
        sourceDeleted: share.item.deletedAt !== null,
        url,
        urlWithPassword: buildDriveUrlWithPassword(url, password),
        passwordEnabled: share.passwordEnabled,
        password,
        expiresAt: share.expiresAt?.toISOString() ?? null,
        createdAt: share.createdAt.toISOString(),
      }
    })
    return {
      items,
      page: buildDrivePublicLinksPage(pageInput, shares.length),
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
      this.prisma.driveItem.count({ where: { userId, deletedAt: null } }),
      this.prisma.driveItem.count({ where: { userId, deletedAt: null, type: DRIVE_ITEM_TYPE.file } }),
      this.prisma.driveItem.count({ where: { userId, deletedAt: null, type: DRIVE_ITEM_TYPE.folder } }),
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
    if (parentId) await this.requireOwnedFolder(userId, parentId)
    const page = normalizeDriveItemTreePage(input)
    const items = await this.prisma.driveItem.findMany({
      where: { userId, deletedAt: null },
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

  async ensureFolderPath(userId: string, input: DriveFolderPathEnsureInput, auditContext: DriveAuditContext = {}): Promise<DriveFolderPathEnsureResultDto> {
    const segments = normalizeDriveFolderPathSegments(input.segments)
    let parentId = input.parentId ?? null
    if (parentId) await this.requireOwnedFolder(userId, parentId)
    const created: DriveItemDto[] = []
    const reused: DriveItemDto[] = []

    for (const name of segments) {
      const fileCollision = await this.prisma.driveItem.findFirst({
        where: { userId, parentId, name, type: DRIVE_ITEM_TYPE.file, deletedAt: null },
        select: { id: true },
      })
      if (fileCollision) throw new BadRequestException("路径中存在同名文件。")

      const existingFolder = await this.prisma.driveItem.findFirst({
        where: { userId, parentId, name, type: DRIVE_ITEM_TYPE.folder, deletedAt: null },
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
    await this.recordDriveAudit({
      userId,
      action: "drive.reorganization.apply",
      targetType: "drive.item",
      targetId: input.planId,
      detail: { userId, planId: input.planId, movedCount: validated.length, skippedCount: plan.skipped.length },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true, movedCount: validated.length, skippedCount: plan.skipped.length }
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

    return {
      context: "owner",
      surface: input.surface,
      current: buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(current), route }),
      breadcrumbs: await this.buildOwnedBrowserBreadcrumbs(root.userId, root, current, route),
      children: children.items.map((item) => buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(item), route })),
      childrenPage: children.page,
      preview: await this.buildBrowserPreview(current, route),
      canDownload: current.type === DRIVE_ITEM_TYPE.file,
      canZip: current.type === DRIVE_ITEM_TYPE.folder,
    }
  }

  async getOwnerConsoleRootBrowserSnapshot(userId: string, childrenPage?: DriveBrowserChildrenPageInput): Promise<DriveBrowserSnapshotDto> {
    const pageInput = normalizeDriveBrowserChildrenPage(childrenPage)
    const children = await this.prisma.driveItem.findMany({
      where: { userId, parentId: null, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
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
        entries: await this.createFolderZipEntries(current.userId, current.id),
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

    return {
      context: "share",
      surface: "standalone",
      current: buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(current), route }),
      breadcrumbs: await this.buildShareBrowserBreadcrumbs(share.ownerId, root, current, route),
      children: children.items.map((item) => buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(item), route })),
      childrenPage: children.page,
      preview: await this.buildBrowserPreview(current, route),
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
        entries: await this.createFolderZipEntries(share.ownerId, current.id),
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
      where: { shareId: input.shareId, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      include: { item: { include: driveItemWithShares } },
    })
    if (!share || share.item.deletedAt || share.item.storageStatus !== DRIVE_STORAGE_STATUS.active) {
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
      })),
      total,
      page: options.pagination.page,
      pageSize: options.pagination.pageSize,
    }
  }

  async deleteItemAsAdmin(itemId: string, actorEmail: string, ipAddress: string): Promise<{ readonly ok: true }> {
    await this.deleteItemInternal({ itemId, actorEmail, ipAddress, admin: true })
    return { ok: true }
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

  async expirePendingUploadSessions(now = new Date()): Promise<{ readonly expired: number }> {
    const sessions = await this.prisma.driveUploadSession.findMany({
      where: { status: DRIVE_UPLOAD_STATUS.pending, expiresAt: { lte: now } },
      select: { id: true, userId: true, expectedSize: true, itemId: true, storageKey: true },
    })
    for (const session of sessions) {
      await this.failUploadSession(session.userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.expired, now, session.storageKey)
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

    for (const move of input.moves) {
      const item = await this.requireOwnedItem(userId, move.itemId)
      const targetParentId = move.targetParentId ?? null
      if (targetParentId === item.id) throw new BadRequestException("不能移动到自身。")
      if (targetParentId) await this.requireOwnedFolder(userId, targetParentId)
      if (item.parentId === targetParentId) {
        skipped.push({ itemId: item.id, reason: "already-in-target" })
        continue
      }
      if (item.type === DRIVE_ITEM_TYPE.folder) {
        await this.assertNoFolderCycle(item.id, targetParentId)
        await this.assertNoDuplicateFolderAtTarget(userId, item.id, item.name, targetParentId)
        movedFolders.push(item.id)
      }
      planned.push({
        itemId: item.id,
        name: item.name,
        fromParentId: item.parentId,
        targetParentId,
        updatedAt: item.updatedAt.toISOString(),
      })
    }

    await this.assertNoRelatedFoldersInReorganization(movedFolders)
    return { planned, skipped }
  }

  private async validateReorganizationPlan(
    userId: string,
    plan: DriveReorganizationPlan,
  ): Promise<DriveReorganizationPlannedMoveDto[]> {
    const movedFolders: string[] = []
    for (const move of plan.moves) {
      const item = await this.requireOwnedItem(userId, move.itemId)
      if (item.parentId !== move.fromParentId || item.updatedAt.toISOString() !== move.updatedAt || item.name !== move.name) {
        throw new BadRequestException("云盘内容已变化，请重新预检。")
      }
      if (move.targetParentId === item.id) throw new BadRequestException("不能移动到自身。")
      if (move.targetParentId) await this.requireOwnedFolder(userId, move.targetParentId)
      if (item.type === DRIVE_ITEM_TYPE.folder) {
        await this.assertNoFolderCycle(item.id, move.targetParentId)
        await this.assertNoDuplicateFolderAtTarget(userId, item.id, item.name, move.targetParentId)
        movedFolders.push(item.id)
      }
    }
    await this.assertNoRelatedFoldersInReorganization(movedFolders)
    return [...plan.moves]
  }

  private async assertNoDuplicateFolderAtTarget(
    userId: string,
    itemId: string,
    name: string,
    targetParentId: string | null,
  ): Promise<void> {
    const duplicate = await this.prisma.driveItem.findFirst({
      where: { userId, parentId: targetParentId, name, type: DRIVE_ITEM_TYPE.folder, deletedAt: null, id: { not: itemId } },
      select: { id: true },
    })
    if (duplicate) throw new BadRequestException("目标位置已有同名文件夹。")
  }

  private async assertNoRelatedFoldersInReorganization(folderIds: readonly string[]): Promise<void> {
    for (let leftIndex = 0; leftIndex < folderIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < folderIds.length; rightIndex += 1) {
        const left = folderIds[leftIndex]
        const right = folderIds[rightIndex]
        if (await this.isDescendantOf(left, right) || await this.isDescendantOf(right, left)) {
          throw new BadRequestException("同一整理计划不能同时移动父子文件夹。")
        }
      }
    }
  }

  private pruneExpiredReorganizationPlans(now = Date.now()): void {
    for (const [planId, plan] of this.reorganizationPlans.entries()) {
      if (plan.expiresAt.getTime() <= now) this.reorganizationPlans.delete(planId)
    }
  }

  private async requireOwnedItem(userId: string, itemId: string) {
    const item = await this.prisma.driveItem.findFirst({
      where: { id: itemId, userId, deletedAt: null },
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
      where: { id: itemId, userId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
      include: driveItemWithShares,
    }) as Promise<DriveItemRecordWithStorage | null>
  }

  private async listActiveChildren(userId: string, parentId: string): Promise<DriveItemRecordWithStorage[]> {
    return this.prisma.driveItem.findMany({
      where: { userId, parentId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
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
      where: { userId, parentId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
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
      const preview = await this.readTextPreview(storageKey)
      const html = kind === "markdown" ? await renderDriveMarkdownFragment(preview.text) : null
      return buildDriveBrowserPreview({ item, route, text: preview.text, html, truncated: preview.truncated })
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
    expectedSize: bigint,
    status: string,
    now = new Date(),
    storageKey?: string,
  ): Promise<boolean> {
    const transitioned = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.driveUploadSession.updateMany({
        where: { id: sessionId, userId, status: DRIVE_UPLOAD_STATUS.pending },
        data: { status, failedAt: now },
      })
      if (updated.count === 0) return false
      await tx.driveItem.update({
        where: { id: itemId },
        data: { storageStatus: DRIVE_STORAGE_STATUS.failed, uploadStatus: status },
      })
      await tx.driveUsage.update({
        where: { userId },
        data: { reservedBytes: { decrement: expectedSize } },
      })
      return true
    })
    if (transitioned && storageKey) await this.deleteStorageObject(itemId, storageKey)
    return transitioned
  }

  private async rollbackFolderUploadPrepare(userId: string, rootItemId: string, now = new Date()): Promise<void> {
    const itemIds = await this.listDriveSubtreeItemIds(this.prisma, userId, rootItemId)
    if (itemIds.length === 0) return

    await this.prisma.$transaction(async (tx) => {
      const pendingSessions = await tx.driveUploadSession.findMany({
        where: { userId, itemId: { in: itemIds }, status: DRIVE_UPLOAD_STATUS.pending },
        select: { id: true, expectedSize: true },
      })
      const pendingSessionIds = pendingSessions.map((session) => session.id)
      const reservedBytes = pendingSessions.reduce((sum, session) => sum + session.expectedSize, 0n)

      if (pendingSessionIds.length > 0) {
        await tx.driveUploadSession.updateMany({
          where: { id: { in: pendingSessionIds }, userId, status: DRIVE_UPLOAD_STATUS.pending },
          data: { status: DRIVE_UPLOAD_STATUS.failed, failedAt: now },
        })
      }
      await tx.driveItem.updateMany({
        where: { id: { in: itemIds }, userId, deletedAt: null },
        data: {
          deletedAt: now,
          storageStatus: DRIVE_STORAGE_STATUS.failed,
          uploadStatus: DRIVE_UPLOAD_STATUS.failed,
        },
      })
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

  private async createUniqueShare(itemId: string, userId: string, type: string, material: DrivePasswordMaterial) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.driveShare.create({
          data: { itemId, userId, type, shareId: createDriveShareId(), ...toDrivePasswordUpdateData(material) },
        })
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const racedShare = await this.prisma.driveShare.findFirst({
          where: { itemId, userId, enabled: true },
        })
        if (racedShare) {
          return this.prisma.driveShare.update({
            where: { id: racedShare.id },
            data: toDrivePasswordUpdateData(material),
          })
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
    const actorEmail = await this.resolveDriveAuditActorEmail(input.userId)
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: input.detail,
      ipAddress: input.ipAddress ?? "system",
    })
  }

  private async resolveDriveAuditActorEmail(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    return user?.email ?? userId
  }

  private async createFolderZipEntries(userId: string, folderId: string): Promise<DriveFolderZipEntry[]> {
    const entries: DriveFolderZipEntry[] = []
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
        entries.push({ path: createUniqueDriveZipEntryPath(childPath, usedPaths), storageKey: child.storageKey })
      }
    }

    return entries
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
        select: { id: true, itemId: true, storageKey: true, expectedSize: true },
      })
      const pendingSessionIds = pendingUploadSessions.map((session) => session.id)
      const pendingItemIds = pendingUploadSessions.map((session) => session.itemId)
      const pendingReservedBytes = pendingUploadSessions.reduce((sum, session) => sum + session.expectedSize, 0n)

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

  private async recordDriveDeleteAuditSafely(input: Parameters<AuditLogService["record"]>[0]): Promise<void> {
    try {
      await this.auditLog?.record(input)
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : undefined,
      }, "Failed to record drive delete audit log")
    }
  }
}

async function ensureUsage(client: DrivePrismaClient, userId: string) {
  return client.driveUsage.upsert({
    where: { userId },
    create: { userId, usedBytes: 0n, reservedBytes: 0n, quotaBytes: driveDefaultQuotaBytes },
    update: {},
  })
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
  readonly item: Parameters<typeof toDriveItemDto>[0] & {
    readonly userId: string
    readonly storageKey: string | null
  }
}): DrivePublicShareValue {
  return {
    item: toDriveItemDto(share.item),
    ownerId: share.item.userId,
    storageKey: share.item.storageKey,
    type: share.item.type === DRIVE_ITEM_TYPE.folder ? "folder" : "file",
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

function normalizeDrivePublicLinksPage(input?: DrivePublicLinksPageInput): { readonly offset: number; readonly limit: number } {
  const requestedOffset = input?.offset
  const requestedLimit = input?.limit
  const offset = typeof requestedOffset === "number" && Number.isFinite(requestedOffset) && requestedOffset > 0
    ? Math.floor(requestedOffset)
    : 0
  const rawLimit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.floor(requestedLimit)
    : 20
  return {
    offset,
    limit: Math.min(rawLimit, 100),
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
