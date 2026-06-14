import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, Optional } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { Readable } from "node:stream"
import {
  type DriveBrowserSnapshotDto,
  buildDriveShareUrl,
  buildDriveUrlWithPassword,
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  type DriveDeleteImpactDto,
  type DriveAccessSettingsInput,
  type DriveFolderUploadPrepareResult,
  type DriveItemDto,
  type DrivePublicationDto,
  type DriveShareDto,
  type DriveShareListItemDto,
  type DriveUploadPrepareResult,
  type DriveUsageDto,
} from "@synapse/shared"
import { AuditLogService } from "../common/audit-log.service"
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
import { renderDriveMarkdownDocument, renderDriveMarkdownFragment } from "./drive-markdown-renderer"
import {
  DRIVE_ITEM_TYPE,
  DRIVE_PUBLICATION_DEPLOYMENT_STATUS,
  DRIVE_PUBLICATION_INDEX_PATH,
  DRIVE_PUBLICATION_STATUS,
  DRIVE_PUBLICATION_TYPE,
  DRIVE_STORAGE_STATUS,
  DRIVE_UPLOAD_STATUS,
  driveDefaultQuotaBytes,
  driveMaxFileBytes,
  driveUploadUrlTtlSeconds,
} from "./drive.constants"
import {
  createDrivePublishId,
  createDriveShareId,
  drivePublicationStorageKey,
  driveStorageKeyForItem,
  isValidDriveItemName,
  normalizePublicationRelativePath,
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
  toDrivePublicationDto,
  toDriveItemDto,
  type DriveAdminFilters,
  type DriveAdminItemDto,
  type DriveItemRecord,
  type DrivePublicationRecord,
  type DrivePrepareFolderUploadInput,
  type DrivePrepareUploadInput,
} from "./drive.types"

type DrivePrismaClient = PrismaService | Prisma.TransactionClient

type PublicationSourceAsset = {
  readonly sourceItemId: string
  readonly sourceStorageKey: string
  readonly relativePath: string
  readonly contentType: string | null
  readonly size: bigint
}

type DrivePublicationWithImpactAssets = DrivePublicationRecord & {
  readonly assets?: readonly { readonly deploymentId: string }[]
}

type DrivePublicAccessResult<T> =
  | { readonly status: "ok"; readonly value: T; readonly cookie?: string }
  | { readonly status: "password_required" }
  | { readonly status: "static_denied" }

type DrivePublicShareValue = {
  readonly item: DriveItemDto
  readonly ownerId: string
  readonly storageKey: string | null
  readonly type: "file" | "folder"
}

type DrivePublishedAssetValue = {
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

const DRIVE_MARKDOWN_RENDER_MAX_BYTES = 10 * 1024 * 1024
const DRIVE_MARKDOWN_RENDER_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none';"

@Injectable()
export class DriveService implements OnApplicationBootstrap {
  private readonly accessSecret = readUserAccessJwtSecret(process.env)
  private readonly logger = new Logger(DriveService.name)

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
    if (requestedSize > driveMaxFileBytes) throw new BadRequestException("文件超过 1GB 限制。")
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
    options: { readonly disablePublications?: boolean; readonly publicAppUrl?: string } = {},
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
      disablePublications: options.disablePublications ?? false,
      publicAppUrl: options.publicAppUrl,
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

  async listShares(userId: string, publicAppUrl: string): Promise<DriveShareListItemDto[]> {
    const shares = await this.prisma.driveShare.findMany({
      where: { userId, enabled: true },
      include: { item: { select: { id: true, name: true, type: true, deletedAt: true } } },
      orderBy: { createdAt: "desc" },
    })
    return shares.map((share) => {
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
  }

  async listPublications(userId: string, publicAppUrl: string): Promise<DrivePublicationDto[]> {
    const publications = await this.prisma.drivePublication.findMany({
      where: { userId },
      include: { sourceItem: { select: { deletedAt: true } } },
      orderBy: { updatedAt: "desc" },
    })
    return publications.map((publication) => toDrivePublicationDto(
      publication,
      publicAppUrl,
      this.decryptStoredPassword(publication.passwordEncrypted),
    ))
  }

  async getDeleteImpact(userId: string, itemId: string, publicAppUrl: string): Promise<DriveDeleteImpactDto> {
    const root = await this.requireOwnedItem(userId, itemId)
    const items = root.type === DRIVE_ITEM_TYPE.folder ? await this.collectSubtree(root.id) : [root]
    const itemIds = items.map((item) => item.id)
    const publications = await this.findActivePublicationsReferencingItems(userId, itemIds)
    return {
      publications: publications.map((publication) => toDrivePublicationDto(
        publication,
        publicAppUrl,
        this.decryptStoredPassword(publication.passwordEncrypted),
      )),
    }
  }

  async publishPage(
    userId: string,
    itemId: string,
    publicAppUrl: string,
    settings: DriveAccessSettingsInput = DRIVE_DEFAULT_ACCESS_SETTINGS,
    auditContext: DriveAuditContext = {},
  ): Promise<DrivePublicationDto> {
    const item = await this.requireOwnedItem(userId, itemId)
    if (item.type !== DRIVE_ITEM_TYPE.file || item.storageStatus !== DRIVE_STORAGE_STATUS.active || !item.storageKey) {
      throw new BadRequestException("只能发布 HTML 文件。")
    }
    if (!isHtmlDriveItem(item.name, item.mimeType)) throw new BadRequestException("只能发布 HTML 文件。")

    const material = await createDrivePasswordMaterial(settings, this.accessSecret)
    const publication = await this.findOrCreatePublication(userId, item.id, DRIVE_PUBLICATION_TYPE.page, item.name, material)
    const result = await this.createDeploymentFromAssets(userId, publication.id, publicAppUrl, [{
      sourceItemId: item.id,
      sourceStorageKey: item.storageKey,
      relativePath: DRIVE_PUBLICATION_INDEX_PATH,
      contentType: "text/html",
      size: item.size,
    }], material)
    await this.recordDriveAudit({
      userId,
      action: "drive.publication.publish",
      targetType: "drive.publication",
      targetId: result.id,
      detail: this.publicationAuditDetail(userId, item.id, result),
      ipAddress: auditContext.ipAddress,
    })
    return result
  }

  async publishSite(
    userId: string,
    itemId: string,
    publicAppUrl: string,
    settings: DriveAccessSettingsInput = DRIVE_DEFAULT_ACCESS_SETTINGS,
    auditContext: DriveAuditContext = {},
  ): Promise<DrivePublicationDto> {
    const folder = await this.requireOwnedFolder(userId, itemId)
    if (folder.storageStatus !== DRIVE_STORAGE_STATUS.active) throw new BadRequestException("站点文件夹不可发布。")
    const files = await this.collectPublicationSiteFiles(userId, folder.id)
    if (!files.some((file) => file.relativePath === DRIVE_PUBLICATION_INDEX_PATH)) {
      throw new BadRequestException("站点根目录需要 index.html。")
    }

    const material = await createDrivePasswordMaterial(settings, this.accessSecret)
    const publication = await this.findOrCreatePublication(userId, folder.id, DRIVE_PUBLICATION_TYPE.site, folder.name, material)
    const result = await this.createDeploymentFromAssets(userId, publication.id, publicAppUrl, files, material)
    await this.recordDriveAudit({
      userId,
      action: "drive.publication.publish",
      targetType: "drive.publication",
      targetId: result.id,
      detail: this.publicationAuditDetail(userId, folder.id, result),
      ipAddress: auditContext.ipAddress,
    })
    return result
  }

  async redeployPublication(userId: string, publicationId: string, publicAppUrl: string, auditContext: DriveAuditContext = {}): Promise<DrivePublicationDto> {
    const publication = await this.prisma.drivePublication.findFirst({
      where: { id: publicationId, userId, status: DRIVE_PUBLICATION_STATUS.active },
    })
    if (!publication?.sourceItemId) throw new NotFoundException("发布不存在。")

    if (publication.type === DRIVE_PUBLICATION_TYPE.site) {
      const folder = await this.requireOwnedFolder(userId, publication.sourceItemId)
      if (folder.storageStatus !== DRIVE_STORAGE_STATUS.active) throw new BadRequestException("站点文件夹不可发布。")
      const files = await this.collectPublicationSiteFiles(userId, folder.id)
      if (!files.some((file) => file.relativePath === DRIVE_PUBLICATION_INDEX_PATH)) {
        throw new BadRequestException("站点根目录需要 index.html。")
      }
      const result = await this.createDeploymentFromAssets(userId, publication.id, publicAppUrl, files)
      await this.recordDriveAudit({
        userId,
        action: "drive.publication.redeploy",
        targetType: "drive.publication",
        targetId: result.id,
        detail: this.publicationAuditDetail(userId, publication.sourceItemId, result),
        ipAddress: auditContext.ipAddress,
      })
      return result
    }

    const item = await this.requireOwnedItem(userId, publication.sourceItemId)
    if (item.type !== DRIVE_ITEM_TYPE.file || item.storageStatus !== DRIVE_STORAGE_STATUS.active || !item.storageKey) {
      throw new BadRequestException("只能发布 HTML 文件。")
    }
    if (!isHtmlDriveItem(item.name, item.mimeType)) throw new BadRequestException("只能发布 HTML 文件。")
    const result = await this.createDeploymentFromAssets(userId, publication.id, publicAppUrl, [{
      sourceItemId: item.id,
      sourceStorageKey: item.storageKey,
      relativePath: DRIVE_PUBLICATION_INDEX_PATH,
      contentType: "text/html",
      size: item.size,
    }])
    await this.recordDriveAudit({
      userId,
      action: "drive.publication.redeploy",
      targetType: "drive.publication",
      targetId: result.id,
      detail: this.publicationAuditDetail(userId, publication.sourceItemId, result),
      ipAddress: auditContext.ipAddress,
    })
    return result
  }

  async disablePublication(userId: string, publicationId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const result = await this.prisma.drivePublication.updateMany({
      where: { id: publicationId, userId, status: DRIVE_PUBLICATION_STATUS.active },
      data: { status: DRIVE_PUBLICATION_STATUS.disabled, disabledAt: new Date() },
    })
    if (result.count === 0) throw new NotFoundException("发布不存在。")
    await this.recordDriveAudit({
      userId,
      action: "drive.publication.disable",
      targetType: "drive.publication",
      targetId: publicationId,
      detail: { userId, publicationId, disabledCount: result.count },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true }
  }

  async resolvePublishedAsset(input: {
    readonly publishId: string
    readonly type: "page" | "site"
    readonly relativePath: string
  }): Promise<DrivePublishedAssetValue> {
    const result = await this.resolvePublishedAssetAccess(input)
    if (result.status !== "ok") throw new NotFoundException("网页未找到")
    return result.value
  }

  async resolvePublishedAssetAccess(input: {
    readonly publishId: string
    readonly type: "page" | "site"
    readonly relativePath: string
    readonly password?: string
    readonly cookie?: string
    readonly now?: Date
  }): Promise<DrivePublicAccessResult<DrivePublishedAssetValue>> {
    const now = input.now ?? new Date()
    const relativePath = normalizePublicationRelativePath(input.relativePath || DRIVE_PUBLICATION_INDEX_PATH)
    const publication = await this.prisma.drivePublication.findFirst({
      where: {
        publishId: input.publishId,
        type: input.type,
        status: DRIVE_PUBLICATION_STATUS.active,
        currentDeploymentId: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    })
    if (!publication?.currentDeploymentId) throw new NotFoundException("网页未找到")

    let cookie: string | undefined
    if (publication.passwordEnabled) {
      const cookieOk = verifyDriveAccessCookie(input.cookie, {
        kind: input.type,
        publicId: publication.publishId,
        now,
        passwordHash: publication.passwordHash,
        resourceExpiresAt: publication.expiresAt,
        secret: this.accessSecret,
      })
      const passwordOk = await verifyDrivePasswordInput(input.password, publication.passwordHash)
      if (!cookieOk && !passwordOk) {
        return isPublicationPasswordPagePath(input.type, relativePath)
          ? { status: "password_required" }
          : { status: "static_denied" }
      }
      if (passwordOk) {
        cookie = buildDriveAccessCookie({
          kind: input.type,
          publicId: publication.publishId,
          expiresAt: publication.expiresAt,
          passwordHash: publication.passwordHash,
          secret: this.accessSecret,
        })
      }
    }

    const deployment = await this.prisma.drivePublicationDeployment.findFirst({
      where: {
        id: publication.currentDeploymentId,
        publicationId: publication.id,
        status: DRIVE_PUBLICATION_DEPLOYMENT_STATUS.active,
      },
    })
    if (!deployment) throw new NotFoundException("网页未找到")

    const asset = await this.prisma.drivePublicationAsset.findUnique({
      where: { deploymentId_relativePath: { deploymentId: publication.currentDeploymentId, relativePath } },
    })
    if (!asset) throw new NotFoundException("网页未找到")

    const object = await this.storage.getObjectStream({ key: asset.storageKey })
    return {
      status: "ok",
      value: {
        stream: object.stream,
        size: object.size ?? asset.size,
        contentType: resolvePublicationContentType(asset.relativePath, asset.contentType ?? object.contentType),
      },
      ...(cookie ? { cookie } : {}),
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

  async getOwnerBrowserSnapshot(input: {
    readonly userId: string
    readonly rootItemId: string
    readonly currentItemId?: string | null
    readonly surface: "standalone" | "console"
  }): Promise<DriveBrowserSnapshotDto> {
    const { root, current } = await this.resolveOwnedBrowserCurrent(input)
    const route: DriveBrowserRouteContext = { context: "owner", surface: input.surface, rootItemId: root.id }
    const children = current.type === DRIVE_ITEM_TYPE.folder
      ? await this.listActiveChildren(root.userId, current.id)
      : []

    return {
      context: "owner",
      surface: input.surface,
      current: buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(current), route }),
      breadcrumbs: await this.buildOwnedBrowserBreadcrumbs(root.userId, root, current, route),
      children: children.map((item) => buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(item), route })),
      preview: await this.buildBrowserPreview(current, route),
      canDownload: current.type === DRIVE_ITEM_TYPE.file,
      canZip: current.type === DRIVE_ITEM_TYPE.folder,
    }
  }

  async getOwnerConsoleRootBrowserSnapshot(userId: string): Promise<DriveBrowserSnapshotDto> {
    const children = await this.prisma.driveItem.findMany({
      where: { userId, parentId: null, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
      include: driveItemWithShares,
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    })

    return {
      context: "owner",
      surface: "console",
      current: buildConsoleDriveRootItemDto(),
      breadcrumbs: [buildConsoleDriveRootBreadcrumb()],
      children: children.map((item) => buildDriveBrowserItemDto({
        item: toDriveBrowserSourceItem(item),
        route: { context: "owner", surface: "console", rootItemId: item.id },
      })),
      preview: null,
      canDownload: false,
      canZip: false,
    }
  }

  async createDownloadUrlForOwnerBrowserItem(input: {
    readonly userId: string
    readonly rootItemId: string
    readonly currentItemId?: string | null
  }): Promise<{ readonly url: string; readonly fileName: string }> {
    const { current } = await this.resolveOwnedBrowserCurrent(input)
    const storageKey = this.requireActiveFileStorage(current)
    const download = await this.storage.createDownloadUrl({ key: storageKey, filename: current.name })
    return { url: download.url, fileName: current.name }
  }

  async createFolderZipEntriesForOwnerBrowserItem(input: {
    readonly userId: string
    readonly rootItemId: string
    readonly currentItemId?: string | null
  }): Promise<DriveFolderZipBrowserResult> {
    const { current } = await this.resolveOwnedBrowserCurrent(input)
    if (current.type !== DRIVE_ITEM_TYPE.folder) throw new NotFoundException("文件未找到")
    return {
      filename: `${current.name}.zip`,
      entries: await this.createFolderZipEntries(current.userId, current.id),
    }
  }

  async resolveOwnerRenderAccess(input: {
    readonly userId: string
    readonly rootItemId: string
    readonly currentItemId?: string | null
  }): Promise<DrivePublishedAssetValue> {
    const { current } = await this.resolveOwnedBrowserCurrent(input)
    const storageKey = this.requireActiveFileStorage(current)
    if (!isHtmlDriveItem(current.name, current.mimeType) && !isMarkdownDriveItem(current.name, current.mimeType)) {
      throw new BadRequestException("只能访问 HTML 或 Markdown 文件。")
    }
    if (isMarkdownDriveItem(current.name, current.mimeType)) {
      if (current.size > BigInt(DRIVE_MARKDOWN_RENDER_MAX_BYTES)) {
        throw new BadRequestException("Markdown 文件超过 10MB，无法渲染。")
      }
      const object = await this.storage.getObjectStream({ key: storageKey })
      const markdown = await readStreamTextPrefix(object.stream, DRIVE_MARKDOWN_RENDER_MAX_BYTES + 1)
      if (markdown.truncated) throw new BadRequestException("Markdown 文件超过 10MB，无法渲染。")
      const html = await renderDriveMarkdownDocument({ title: current.name, markdown: markdown.text })
      return {
        stream: Readable.from(html),
        size: BigInt(Buffer.byteLength(html, "utf8")),
        contentType: "text/html; charset=utf-8",
        csp: DRIVE_MARKDOWN_RENDER_CSP,
      }
    }
    const object = await this.storage.getObjectStream({ key: storageKey })
    return {
      stream: object.stream,
      size: object.size ?? current.size,
      contentType: "text/html; charset=utf-8",
    }
  }

  async resolveOwnerHtmlRenderAccess(input: {
    readonly userId: string
    readonly rootItemId: string
    readonly currentItemId?: string | null
  }): Promise<DrivePublishedAssetValue> {
    return this.resolveOwnerRenderAccess(input)
  }

  async getShareBrowserSnapshot(input: {
    readonly shareId: string
    readonly itemId?: string | null
    readonly password?: string
    readonly cookie?: string
    readonly accessCookie?: string
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
      ? await this.listActiveChildren(share.ownerId, current.id)
      : []

    return {
      context: "share",
      surface: "standalone",
      current: buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(current), route }),
      breadcrumbs: await this.buildShareBrowserBreadcrumbs(share.ownerId, root, current, route),
      children: children.map((item) => buildDriveBrowserItemDto({ item: toDriveBrowserSourceItem(item), route })),
      preview: await this.buildBrowserPreview(current, route),
      canDownload: current.type === DRIVE_ITEM_TYPE.file,
      canZip: current.type === DRIVE_ITEM_TYPE.folder,
    }
  }

  async createDownloadUrlForShareBrowserItem(input: {
    readonly shareId: string
    readonly itemId?: string | null
    readonly password?: string
    readonly cookie?: string
    readonly accessCookie?: string
  }): Promise<{ readonly url: string; readonly fileName: string }> {
    const share = await this.resolvePublicShare({
      shareId: input.shareId,
      password: input.password,
      cookie: input.cookie ?? input.accessCookie,
    })
    const { current } = await this.resolveShareBrowserCurrent(share, input.itemId)
    const storageKey = this.requireActiveFileStorage(current)
    const download = await this.storage.createDownloadUrl({ key: storageKey, filename: current.name })
    return { url: download.url, fileName: current.name }
  }

  async createFolderZipEntriesForShareBrowserItem(input: {
    readonly shareId: string
    readonly itemId?: string | null
    readonly password?: string
    readonly cookie?: string
    readonly accessCookie?: string
  }): Promise<DriveFolderZipBrowserResult> {
    const share = await this.resolvePublicShare({
      shareId: input.shareId,
      password: input.password,
      cookie: input.cookie ?? input.accessCookie,
    })
    const { current } = await this.resolveShareBrowserCurrent(share, input.itemId)
    if (current.type !== DRIVE_ITEM_TYPE.folder) throw new NotFoundException("文件未找到")
    return {
      filename: `${current.name}.zip`,
      entries: await this.createFolderZipEntries(share.ownerId, current.id),
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

  async createDownloadUrlForShare(input: {
    readonly shareId: string
    readonly password?: string
    readonly cookie?: string
  }): Promise<{ readonly url: string }> {
    const share = await this.resolvePublicShare(input)
    if (share.type !== "file" || !share.storageKey) throw new NotFoundException("文件未找到")
    const download = await this.storage.createDownloadUrl({ key: share.storageKey, filename: share.item.name })
    return { url: download.url }
  }

  async listPublicFolderChildren(input: {
    readonly shareId: string
    readonly password?: string
    readonly cookie?: string
  }): Promise<{ readonly item: DriveItemDto; readonly children: DriveItemDto[] }> {
    const share = await this.resolvePublicShare(input)
    if (share.type !== "folder") throw new NotFoundException("文件未找到")
    const children = await this.prisma.driveItem.findMany({
      where: { userId: share.ownerId, parentId: share.item.id, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
      include: driveItemWithShares,
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    })
    return { item: share.item, children: children.map(toDriveItemDto) }
  }

  async createDownloadUrlForShareChild(input: {
    readonly shareId: string
    readonly itemId: string
    readonly password?: string
    readonly cookie?: string
  }): Promise<{ readonly url: string }> {
    const share = await this.resolvePublicShare(input)
    if (share.type !== "folder") throw new NotFoundException("文件未找到")
    const child = await this.prisma.driveItem.findFirst({
      where: {
        id: input.itemId,
        userId: share.ownerId,
        type: DRIVE_ITEM_TYPE.file,
        storageStatus: DRIVE_STORAGE_STATUS.active,
        deletedAt: null,
      },
      include: driveItemWithShares,
    })
    if (!child || !child.storageKey || !await this.isDescendantOf(child.id, share.item.id)) {
      throw new NotFoundException("文件未找到")
    }
    const download = await this.storage.createDownloadUrl({ key: child.storageKey, filename: child.name })
    return { url: download.url }
  }

  async createFolderZipEntriesForShare(input: {
    readonly shareId: string
    readonly password?: string
    readonly cookie?: string
  }): Promise<DriveFolderZipEntry[]> {
    const share = await this.resolvePublicShare(input)
    if (share.type !== "folder") throw new NotFoundException("文件未找到")
    return this.createFolderZipEntries(share.ownerId, share.item.id)
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

  async backfillLegacyDriveAccessProtection(now = new Date()): Promise<{ readonly shares: number; readonly publications: number }> {
    const legacyShares = await this.prisma.driveShare.findMany({
      where: { enabled: true, passwordEnabled: false, passwordHash: null, accessSettingsAppliedAt: null },
      select: { id: true },
    })
    const legacyPublications = await this.prisma.drivePublication.findMany({
      where: { status: DRIVE_PUBLICATION_STATUS.active, passwordEnabled: false, passwordHash: null, accessSettingsAppliedAt: null },
      select: { id: true },
    })

    let shares = 0
    let publications = 0
    for (const share of legacyShares) {
      const material = await createDrivePasswordMaterial(DRIVE_DEFAULT_ACCESS_SETTINGS, this.accessSecret, now)
      const result = await this.prisma.driveShare.updateMany({
        where: { id: share.id, enabled: true, passwordEnabled: false, passwordHash: null, accessSettingsAppliedAt: null },
        data: toDrivePasswordUpdateData(material, now),
      })
      if (result.count === 1) shares += 1
    }
    for (const publication of legacyPublications) {
      const material = await createDrivePasswordMaterial(DRIVE_DEFAULT_ACCESS_SETTINGS, this.accessSecret, now)
      const result = await this.prisma.drivePublication.updateMany({
        where: { id: publication.id, status: DRIVE_PUBLICATION_STATUS.active, passwordEnabled: false, passwordHash: null, accessSettingsAppliedAt: null },
        data: toDrivePasswordUpdateData(material, now),
      })
      if (result.count === 1) publications += 1
    }

    return { shares, publications }
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
    readonly rootItemId: string
    readonly currentItemId?: string | null
  }): Promise<{ readonly root: DriveItemRecordWithStorage; readonly current: DriveItemRecordWithStorage }> {
    const root = await this.requireOwnedItem(input.userId, input.rootItemId) as DriveItemRecordWithStorage
    this.assertActiveBrowserItem(root)
    if (!input.currentItemId || input.currentItemId === root.id) return { root, current: root }

    const current = await this.requireOwnedItem(input.userId, input.currentItemId) as DriveItemRecordWithStorage
    this.assertActiveBrowserItem(current)
    if (!await this.isDescendantOf(current.id, root.id)) throw new NotFoundException("文件未找到")
    return { root, current }
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
      const download = await this.storage.createDownloadUrl({ key: storageKey, filename: current.name })
      return buildDriveBrowserPreview({ item, route, imageUrl: download.url })
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

  private async findOrCreatePublication(
    userId: string,
    sourceItemId: string,
    type: string,
    name: string,
    material: DrivePasswordMaterial,
  ): Promise<DrivePublicationRecord> {
    const activeSourceWhere = { userId, sourceItemId, type, status: DRIVE_PUBLICATION_STATUS.active }
    const existing = await this.prisma.drivePublication.findFirst({ where: activeSourceWhere })
    if (existing) return existing

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.drivePublication.create({
          data: {
            userId,
            sourceItemId,
            type,
            name,
            status: DRIVE_PUBLICATION_STATUS.active,
            publishId: createDrivePublishId(),
            ...toDrivePasswordUpdateData(material),
          },
        })
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
        const racedPublication = await this.prisma.drivePublication.findFirst({ where: activeSourceWhere })
        if (racedPublication) return racedPublication
      }
    }
    throw new Error("Unable to create unique drive publish id.")
  }

  private async createDeploymentFromAssets(
    userId: string,
    publicationId: string,
    publicAppUrl: string,
    assets: readonly PublicationSourceAsset[],
    material?: DrivePasswordMaterial,
  ): Promise<DrivePublicationDto> {
    const publication = await this.prisma.drivePublication.findFirst({ where: { id: publicationId, userId } })
    if (!publication) throw new NotFoundException("发布不存在。")
    const previousDeploymentId = publication.currentDeploymentId
    const previousAssets = previousDeploymentId
      ? await this.prisma.drivePublicationAsset.findMany({
        where: { publicationId, deploymentId: previousDeploymentId },
        select: { storageKey: true },
      })
      : []
    const deployment = await this.prisma.drivePublicationDeployment.create({
      data: { publicationId, status: DRIVE_PUBLICATION_DEPLOYMENT_STATUS.pending },
    })
    const copiedStorageKeys: string[] = []

    try {
      const assetRows: Prisma.DrivePublicationAssetCreateManyInput[] = []
      const seenPaths = new Set<string>()
      for (const asset of assets) {
        const relativePath = normalizePublicationRelativePath(asset.relativePath)
        const pathKey = relativePath.toLowerCase()
        if (seenPaths.has(pathKey)) throw new BadRequestException("站点文件路径重复。")
        seenPaths.add(pathKey)
        const storageKey = drivePublicationStorageKey({ publicationId, deploymentId: deployment.id, relativePath })
        await this.storage.copyObject({
          fromKey: asset.sourceStorageKey,
          toKey: storageKey,
          contentType: asset.contentType,
        })
        copiedStorageKeys.push(storageKey)
        assetRows.push({
          publicationId,
          deploymentId: deployment.id,
          sourceItemId: asset.sourceItemId,
          relativePath,
          storageKey,
          contentType: asset.contentType,
          size: asset.size,
        })
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.drivePublicationAsset.createMany({ data: assetRows })
        await tx.drivePublicationDeployment.update({
          where: { id: deployment.id },
          data: { status: DRIVE_PUBLICATION_DEPLOYMENT_STATUS.active, activatedAt: new Date() },
        })
        if (previousDeploymentId) {
          await tx.drivePublicationDeployment.update({
            where: { id: previousDeploymentId },
            data: { status: DRIVE_PUBLICATION_DEPLOYMENT_STATUS.superseded },
          })
        }
        return tx.drivePublication.update({
          where: { id: publicationId },
          data: {
            currentDeploymentId: deployment.id,
            status: DRIVE_PUBLICATION_STATUS.active,
            ...(material ? toDrivePasswordUpdateData(material) : {}),
          },
          include: { sourceItem: { select: { deletedAt: true } } },
        })
      })
      if (previousDeploymentId && previousAssets.length > 0) {
        await this.cleanupSupersededPublicationObjects({
          publicationId,
          deploymentId: previousDeploymentId,
          replacementDeploymentId: deployment.id,
          storageKeys: previousAssets.map((asset) => asset.storageKey),
        })
      }
      return toDrivePublicationDto(updated, publicAppUrl, this.decryptStoredPassword(updated.passwordEncrypted))
    } catch (error) {
      await this.cleanupCopiedPublicationObjects({
        publicationId,
        deploymentId: deployment.id,
        storageKeys: copiedStorageKeys,
        failure: error,
      })
      const failedAt = new Date()
      await this.prisma.$transaction([
        this.prisma.drivePublicationDeployment.update({
          where: { id: deployment.id },
          data: {
            status: DRIVE_PUBLICATION_DEPLOYMENT_STATUS.failed,
            error: error instanceof Error ? error.message : "Publication failed.",
          },
        }),
        ...(publication.currentDeploymentId
          ? []
          : [this.prisma.drivePublication.update({
            where: { id: publicationId },
            data: { status: DRIVE_PUBLICATION_STATUS.disabled, disabledAt: failedAt },
          })]),
      ])
      throw error
    }
  }

  private async cleanupSupersededPublicationObjects(input: {
    readonly publicationId: string
    readonly deploymentId: string
    readonly replacementDeploymentId: string
    readonly storageKeys: readonly string[]
  }): Promise<void> {
    let failed = false
    for (const storageKey of input.storageKeys) {
      try {
        await this.storage.deleteObject(storageKey)
      } catch (error) {
        failed = true
        this.logger.warn({
          publicationId: input.publicationId,
          deploymentId: input.deploymentId,
          replacementDeploymentId: input.replacementDeploymentId,
          storageKey,
          cleanupErrorName: error instanceof Error ? error.name : typeof error,
          cleanupErrorMessage: error instanceof Error ? error.message : undefined,
        }, "Drive superseded publication object cleanup failed")
      }
    }
    if (failed) return

    try {
      await this.prisma.drivePublicationAsset.deleteMany({
        where: { publicationId: input.publicationId, deploymentId: input.deploymentId },
      })
    } catch (error) {
      this.logger.warn({
        publicationId: input.publicationId,
        deploymentId: input.deploymentId,
        replacementDeploymentId: input.replacementDeploymentId,
        cleanupErrorName: error instanceof Error ? error.name : typeof error,
        cleanupErrorMessage: error instanceof Error ? error.message : undefined,
      }, "Drive superseded publication asset row cleanup failed")
    }
  }

  private async cleanupCopiedPublicationObjects(input: {
    readonly publicationId: string
    readonly deploymentId: string
    readonly storageKeys: readonly string[]
    readonly failure: unknown
  }): Promise<void> {
    for (const storageKey of input.storageKeys) {
      try {
        await this.storage.deleteObject(storageKey)
      } catch (error) {
        this.logger.warn({
          publicationId: input.publicationId,
          deploymentId: input.deploymentId,
          storageKey,
          failureName: input.failure instanceof Error ? input.failure.name : typeof input.failure,
          failureMessage: input.failure instanceof Error ? input.failure.message : undefined,
          cleanupErrorName: error instanceof Error ? error.name : typeof error,
          cleanupErrorMessage: error instanceof Error ? error.message : undefined,
        }, "Drive publication copied object cleanup failed")
      }
    }
  }

  private publicationAuditDetail(
    userId: string,
    itemId: string | null,
    publication: DrivePublicationDto,
  ): Record<string, unknown> {
    return {
      userId,
      itemId,
      publicationId: publication.id,
      publishId: publication.publishId,
      type: publication.type,
      currentDeploymentId: publication.currentDeploymentId,
      passwordEnabled: publication.passwordEnabled,
      expiresAt: publication.expiresAt,
    }
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

  private async collectPublicationSiteFiles(userId: string, rootId: string): Promise<PublicationSourceAsset[]> {
    const result: PublicationSourceAsset[] = []
    const queue: Array<{ readonly parentId: string; readonly prefix: string }> = [{ parentId: rootId, prefix: "" }]
    const seenPaths = new Set<string>()

    while (queue.length > 0) {
      const current = queue.shift()!
      const children = await this.prisma.driveItem.findMany({
        where: { userId, parentId: current.parentId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      })
      for (const child of children) {
        const relativePath = current.prefix ? `${current.prefix}/${child.name}` : child.name
        const normalized = normalizePublicationRelativePath(relativePath)
        if (child.type === DRIVE_ITEM_TYPE.folder) {
          queue.push({ parentId: child.id, prefix: normalized })
          continue
        }
        if (!child.storageKey) continue
        const pathKey = normalized.toLowerCase()
        if (seenPaths.has(pathKey)) throw new BadRequestException("站点文件路径重复。")
        seenPaths.add(pathKey)
        result.push({
          sourceItemId: child.id,
          sourceStorageKey: child.storageKey,
          relativePath: normalized,
          contentType: child.mimeType,
          size: child.size,
        })
      }
    }

    return result
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

  private async findActivePublicationsReferencingItems(userId: string, itemIds: readonly string[]): Promise<DrivePublicationWithImpactAssets[]> {
    if (itemIds.length === 0) return []
    const publications = await this.prisma.drivePublication.findMany({
      where: {
        userId,
        status: DRIVE_PUBLICATION_STATUS.active,
      },
      include: {
        sourceItem: { select: { deletedAt: true } },
        assets: { where: { sourceItemId: { in: [...itemIds] } }, select: { deploymentId: true } },
      },
      orderBy: { updatedAt: "desc" },
    })
    return publications.filter((publication) => (
      itemIds.includes(publication.sourceItemId ?? "")
      || publication.assets.some((asset) => asset.deploymentId === publication.currentDeploymentId)
    ))
  }

  private async deleteItemInternal(input: {
    readonly itemId: string
    readonly userId?: string
    readonly actorEmail: string
    readonly ipAddress: string
    readonly admin: boolean
    readonly disablePublications?: boolean
    readonly publicAppUrl?: string
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
    const impactedPublications = input.disablePublications
      ? await this.findActivePublicationsReferencingItems(root.userId, itemIds)
      : []
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
      if (impactedPublications.length > 0) {
        await tx.drivePublication.updateMany({
          where: { id: { in: impactedPublications.map((publication) => publication.id) } },
          data: { status: DRIVE_PUBLICATION_STATUS.disabled, disabledAt: deletedAt },
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
        storageKey,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : undefined,
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
  const name = value.trim()
  if (!isValidDriveItemName(name)) throw new BadRequestException("文件名无效。")
  return name
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

function resolvePublicationContentType(relativePath: string, stored: string | null | undefined): string {
  const lowerPath = relativePath.toLowerCase()
  if (lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")) return "text/html; charset=utf-8"
  if (lowerPath.endsWith(".css")) return "text/css; charset=utf-8"
  if (lowerPath.endsWith(".js") || lowerPath.endsWith(".mjs")) return "application/javascript; charset=utf-8"
  if (lowerPath.endsWith(".json")) return "application/json; charset=utf-8"
  return stored || "application/octet-stream"
}

function isPublicationPasswordPagePath(type: "page" | "site", relativePath: string): boolean {
  if (type === "page") return relativePath === DRIVE_PUBLICATION_INDEX_PATH
  const lowerPath = relativePath.toLowerCase()
  return lowerPath === DRIVE_PUBLICATION_INDEX_PATH || lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")
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

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function readUserAccessJwtSecret(source: NodeJS.ProcessEnv): string {
  const secret = source.USER_ACCESS_JWT_SECRET
  if (!secret || secret.length < 32) throw new Error("服务端环境变量无效：USER_ACCESS_JWT_SECRET")
  return secret
}
