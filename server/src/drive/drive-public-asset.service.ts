import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, PayloadTooLargeException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {
  DRIVE_MAX_FILE_SIZE_LABEL,
  DRIVE_PUBLIC_ASSET_IMAGE_UNSUPPORTED_FORMAT_MESSAGE,
  DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE,
  drivePublicAssetContentKind,
  isDrivePublicAssetId,
  maskDriveBrowserUrl,
  type DrivePublicAssetDto,
  type DrivePublicAssetListPageDto,
  type DriveUploadPrepareResult,
} from "@synapse/shared"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { AuditLogService } from "../common/audit-log.service"
import { formatAuditError } from "../common/audit-error"
import { toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"
import {
  DRIVE_ITEM_LIFECYCLE_STATUS,
  DRIVE_ITEM_TYPE,
  DRIVE_STORAGE_STATUS,
  DRIVE_UPLOAD_PURPOSE,
  DRIVE_UPLOAD_STATUS,
  drivePublicAssetMaxFileBytes,
  driveUploadUrlTtlSeconds,
} from "./drive.constants"
import { DriveLifecycleService } from "./drive-lifecycle.service"
import { matchesPublicAssetContentSignature, validatePublicAssetNameAndMime } from "./drive-public-asset-policy"
import type { DriveStoragePort } from "./drive-storage"
import { createDrivePublicAssetId, driveOverwriteStorageKeyForSession, driveStorageKeyForItem, isValidDriveItemName } from "./drive-token"
import { reserveDriveUsageBytes } from "./drive-usage"
import {
  toDriveAdminPublicAssetAccessLogDto,
  toDriveAdminPublicAssetDto,
  toDriveAdminPublicAssetRevisionDto,
  toDriveItemDto,
  toDrivePublicAssetDto,
  type DriveAdminPublicAssetAccessLogDto,
  type DriveAdminPublicAssetDto,
  type DriveAdminPublicAssetRevisionDto,
  type DrivePublicAssetListInput,
  type DrivePublicAssetPrepareUploadInput,
  type DrivePublicAssetRecord,
} from "./drive.types"

type DrivePrismaClient = PrismaService | Prisma.TransactionClient

type DriveAuditContext = {
  readonly ipAddress?: string
  readonly publicAppUrl?: string
}

type PublicAssetWithItem = DrivePublicAssetRecord & {
  readonly id: string
  readonly userId: string
  readonly originalName: string
  readonly storageKey: string
  readonly etag: string | null
  readonly item: {
    readonly id: string
    readonly userId: string
    readonly parentId: string | null
    readonly type: string
    readonly name: string
    readonly size: bigint
    readonly mimeType: string | null
    readonly storageKey: string | null
    readonly storageStatus: string
    readonly uploadStatus: string
    readonly lifecycleStatus: string
    readonly objectMissing: boolean
    readonly deletedAt: Date | null
    readonly createdAt: Date
    readonly updatedAt: Date
  }
}

type PublicAssetWithOwner = PublicAssetWithItem & {
  readonly user: { readonly email: string | null }
}

type PublicAssetUploadSession = {
  readonly id: string
  readonly userId: string
  readonly itemId: string
  readonly storageKey: string
  readonly expectedName: string
  readonly expectedSize: bigint
  readonly expectedMime: string | null
  readonly reservedBytes: bigint
  readonly purpose: string
  readonly publicAssetId: string | null
  readonly replacePreviousStorageKey: string | null
  readonly status: string
  readonly expiresAt: Date
  readonly item: PublicAssetWithItem["item"]
}

export type DriveResolvedPublicAsset =
  | { readonly status: "not_found"; readonly assetId: string }
  | {
    readonly status: "not_modified"
    readonly assetId: string
    readonly publicAssetId: string
    readonly userId: string
    readonly etag: string
  }
  | {
    readonly status: "ok"
    readonly assetId: string
    readonly publicAssetId: string
    readonly userId: string
    readonly storageKey: string
    readonly name: string
    readonly mimeType: string
    readonly size: bigint
    readonly etag: string | null
  }

export type DrivePublicAssetAccessInput = {
  readonly assetId: string
  readonly publicAssetId?: string | null
  readonly userId?: string | null
  readonly ip?: string | null
  readonly referer?: string | null
  readonly userAgent?: string | null
  readonly method: string
  readonly statusCode: number
  readonly bytes?: bigint
}

const PUBLIC_ASSET_LIST_DEFAULT_LIMIT = 50
const PUBLIC_ASSET_LIST_MAX_LIMIT = 200
const PUBLIC_ASSET_SIGNATURE_READ_BYTES = 4096

@Injectable()
export class DrivePublicAssetService {
  private readonly logger = new Logger(DrivePublicAssetService.name)
  private readonly publicAppUrlsBySessionId = new Map<string, string>()

  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly lifecycle?: DriveLifecycleService,
  ) {}

  async listAssets(userId: string, publicAppUrl: string, input: DrivePublicAssetListInput = {}): Promise<DrivePublicAssetListPageDto> {
    const page = normalizePublicAssetPage(input)
    const search = input.search?.trim()
    const where: Prisma.PublicAssetWhereInput = {
      userId,
      deletedAt: null,
      lifecycleStatus: { in: [
        DRIVE_ITEM_LIFECYCLE_STATUS.active,
        DRIVE_ITEM_LIFECYCLE_STATUS.trashed,
        DRIVE_ITEM_LIFECYCLE_STATUS.legacyMissing,
      ] },
      ...(search
        ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { assetId: { contains: search, mode: "insensitive" } },
          ],
        }
        : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.publicAsset.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit + 1,
      }),
      this.prisma.publicAsset.count({ where }),
    ])
    return {
      items: items.slice(0, page.limit).map((asset) => toDrivePublicAssetDto(asset, publicAppUrl)),
      total,
      page: {
        offset: page.offset,
        limit: page.limit,
        hasMore: items.length > page.limit,
        nextOffset: items.length > page.limit ? page.offset + page.limit : null,
      },
    }
  }

  async getAsset(userId: string, assetId: string, publicAppUrl: string): Promise<DrivePublicAssetDto> {
    return toDrivePublicAssetDto(await this.requireOwnedAsset(userId, assetId, { includeMissing: true }), publicAppUrl)
  }

  async listAdminAssets(
    publicAppUrl: string,
    input: {
      readonly pagination: PaginationQuery
      readonly search?: string
      readonly userId?: string
      readonly lifecycleStatus?: string
    },
  ): Promise<PaginatedResponse<DriveAdminPublicAssetDto>> {
    const where: Prisma.PublicAssetWhereInput = {
      deletedAt: null,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.lifecycleStatus ? { lifecycleStatus: input.lifecycleStatus } : {}),
      ...(input.search
        ? {
          OR: [
            { name: { contains: input.search, mode: "insensitive" } },
            { assetId: { contains: input.search, mode: "insensitive" } },
            { itemId: { contains: input.search, mode: "insensitive" } },
            { user: { email: { contains: input.search, mode: "insensitive" } } },
          ],
        }
        : {}),
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.publicAsset.findMany({
        ...toPrismaArgs(input.pagination),
        where,
        include: { item: true, user: { select: { email: true } } },
      }),
      this.prisma.publicAsset.count({ where }),
    ])
    return {
      data: (data as PublicAssetWithOwner[]).map((asset) => toDriveAdminPublicAssetDto(asset, publicAppUrl)),
      total,
      page: input.pagination.page,
      pageSize: input.pagination.pageSize,
    }
  }

  async getAdminAsset(assetId: string, publicAppUrl: string): Promise<DriveAdminPublicAssetDto> {
    this.assertPublicAssetId(assetId)
    const asset = await this.prisma.publicAsset.findFirst({
      where: { assetId, deletedAt: null },
      include: { item: true, user: { select: { email: true } } },
    }) as PublicAssetWithOwner | null
    if (!asset) throw new NotFoundException("公共资源不存在。")
    return toDriveAdminPublicAssetDto(asset, publicAppUrl)
  }

  async listAdminAccessLogs(assetId: string, pagination: PaginationQuery): Promise<PaginatedResponse<DriveAdminPublicAssetAccessLogDto>> {
    this.assertPublicAssetId(assetId)
    await this.requireAdminAsset(assetId)
    const where = { assetId }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.publicAssetAccessLog.findMany({
        ...toPrismaArgs(pagination),
        where,
      }),
      this.prisma.publicAssetAccessLog.count({ where }),
    ])
    return {
      data: data.map(toDriveAdminPublicAssetAccessLogDto),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  }

  async listAdminRevisions(assetId: string, pagination: PaginationQuery): Promise<PaginatedResponse<DriveAdminPublicAssetRevisionDto>> {
    this.assertPublicAssetId(assetId)
    await this.requireAdminAsset(assetId)
    const where = { assetId }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.publicAssetRevision.findMany({
        ...toPrismaArgs(pagination),
        where,
      }),
      this.prisma.publicAssetRevision.count({ where }),
    ])
    return {
      data: data.map(toDriveAdminPublicAssetRevisionDto),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    }
  }

  async openAdminRevisionDownload(assetId: string, revisionId: string) {
    this.assertPublicAssetId(assetId)
    const revision = await this.prisma.publicAssetRevision.findFirst({
      where: { id: revisionId, assetId },
    })
    if (!revision) throw new NotFoundException("历史版本不存在。")
    const info = await this.storage.headObject(revision.storageKey)
    if (!info) throw new NotFoundException("历史版本不存在。")
    const object = await this.storage.getObjectStream({ key: revision.storageKey })
    return {
      stream: object.stream,
      fileName: revision.name,
      size: object.size ?? info.size,
      contentType: object.contentType ?? revision.mimeType,
    }
  }

  async prepareUpload(userId: string, input: DrivePublicAssetPrepareUploadInput): Promise<DriveUploadPrepareResult> {
    const normalized = normalizePublicAssetUploadInput(input)
    const result = await this.prisma.$transaction(async (tx) => {
      const item = await tx.driveItem.create({
        data: {
          userId,
          parentId: null,
          type: DRIVE_ITEM_TYPE.file,
          name: normalized.name,
          size: normalized.size,
          mimeType: normalized.mimeType,
          storageStatus: DRIVE_STORAGE_STATUS.pending,
          uploadStatus: DRIVE_UPLOAD_STATUS.pending,
        },
      })
      const storageKey = driveStorageKeyForItem(item.id)
      const updatedItem = await tx.driveItem.update({ where: { id: item.id }, data: { storageKey } })
      const session = await tx.driveUploadSession.create({
        data: {
          userId,
          itemId: item.id,
          storageKey,
          expectedName: normalized.name,
          expectedSize: normalized.size,
          expectedMime: normalized.mimeType,
          reservedBytes: normalized.size,
          purpose: DRIVE_UPLOAD_PURPOSE.publicAssetUpload,
          status: DRIVE_UPLOAD_STATUS.pending,
          credentialKind: "presigned_put",
          expiresAt: new Date(Date.now() + driveUploadUrlTtlSeconds * 1000),
        },
      })
      await reserveDriveUsageBytes(tx, userId, normalized.size)
      return { item: updatedItem, session }
    })
    this.rememberPublicAppUrl(result.session.id, input.publicAppUrl)

    try {
      return await this.buildPrepareResult(result, normalized.mimeType)
    } catch (error) {
      await this.failSession(userId, result.session, DRIVE_UPLOAD_STATUS.failed)
      throw error
    }
  }

  async completeUpload(userId: string, sessionId: string, auditContext: DriveAuditContext = {}): Promise<DrivePublicAssetDto> {
    const session = await this.requireUploadSession(userId, sessionId, DRIVE_UPLOAD_PURPOSE.publicAssetUpload)
    const publicAppUrl = auditContext.publicAppUrl ?? this.publicAppUrlsBySessionId.get(session.id) ?? "https://synapse.local"
    if (session.status === DRIVE_UPLOAD_STATUS.completed) {
      const current = await this.findAssetDtoForSession(userId, session, publicAppUrl)
      if (current) return current
      throw new NotFoundException("上传会话不存在。")
    }
    if (session.status !== DRIVE_UPLOAD_STATUS.pending) throw new NotFoundException("上传会话不存在。")
    await this.validateUploadedObject(session)

    try {
      const asset = await this.createAssetWithRetry(userId, session)
      this.forgetPublicAppUrl(session.id)
      await this.recordAuditSafely({
        userId,
        action: "drive.public_asset.upload.complete",
        targetType: "drive.publicAsset",
        targetId: asset.assetId,
        detail: { userId, sessionId: session.id, assetId: asset.assetId, itemId: asset.itemId, name: asset.name },
        ipAddress: auditContext.ipAddress,
      })
      return toDrivePublicAssetDto(asset, publicAppUrl)
    } catch (error) {
      const transitioned = await this.failSession(userId, session, DRIVE_UPLOAD_STATUS.failed)
      if (!transitioned) {
        const current = await this.findAssetDtoForSession(userId, session, publicAppUrl)
        if (current) return current
      }
      throw error
    }
  }

  async importImageBuffer(userId: string, publicAppUrl: string, input: {
    readonly name: string
    readonly mimeType: string
    readonly body: Buffer
  }): Promise<DrivePublicAssetDto> {
    if (drivePublicAssetContentKind(input.mimeType) !== "image") {
      throw new BadRequestException(DRIVE_PUBLIC_ASSET_IMAGE_UNSUPPORTED_FORMAT_MESSAGE)
    }
    let session: PublicAssetUploadSession | null = null
    try {
      const prepared = await this.prepareUpload(userId, {
        name: input.name,
        mimeType: input.mimeType,
        size: input.body.byteLength.toString(),
        publicAppUrl,
      })
      session = await this.requireUploadSession(userId, prepared.sessionId, DRIVE_UPLOAD_PURPOSE.publicAssetUpload)
      await this.storage.putObject({
        key: session.storageKey,
        body: input.body,
        contentType: input.mimeType,
      })
      return await this.completeUpload(userId, session.id, { publicAppUrl })
    } catch (error) {
      if (session) await this.failSessionSafely(userId, session)
      throw error
    }
  }

  async copyPublicAssetToUser(userId: string, sourceAssetId: string, publicAppUrl: string): Promise<DrivePublicAssetDto> {
    const source = await this.requireActivePublicAsset(sourceAssetId)
    if (drivePublicAssetContentKind(source.mimeType) !== "image") {
      throw new BadRequestException(DRIVE_PUBLIC_ASSET_IMAGE_UNSUPPORTED_FORMAT_MESSAGE)
    }
    let session: PublicAssetUploadSession | null = null
    try {
      const prepared = await this.prepareUpload(userId, {
        name: source.name,
        mimeType: source.mimeType,
        size: source.size.toString(),
        publicAppUrl,
      })
      session = await this.requireUploadSession(userId, prepared.sessionId, DRIVE_UPLOAD_PURPOSE.publicAssetUpload)
      await this.storage.copyObject({
        fromKey: source.storageKey,
        toKey: session.storageKey,
        contentType: source.mimeType,
      })
      return await this.completeUpload(userId, session.id, { publicAppUrl })
    } catch (error) {
      if (session) await this.failSessionSafely(userId, session)
      throw error
    }
  }

  async cancelUpload(userId: string, sessionId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const session = await this.requirePendingSession(userId, sessionId, DRIVE_UPLOAD_PURPOSE.publicAssetUpload)
    await this.failSession(userId, session, DRIVE_UPLOAD_STATUS.cancelled)
    await this.recordAuditSafely({
      userId,
      action: "drive.public_asset.upload.cancel",
      targetType: "drive.uploadSession",
      targetId: session.id,
      detail: { userId, sessionId: session.id },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true }
  }

  async prepareReplace(userId: string, assetId: string, input: DrivePublicAssetPrepareUploadInput): Promise<DriveUploadPrepareResult> {
    const asset = await this.requireOwnedAsset(userId, assetId)
    if (asset.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active || asset.item.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active) {
      throw new NotFoundException("公共资源不存在。")
    }
    const normalized = normalizePublicAssetUploadInput(input)
    if (drivePublicAssetContentKind(asset.mimeType) !== drivePublicAssetContentKind(normalized.mimeType)) {
      throw new BadRequestException("图片和文档不能互相替换。")
    }
    const reservedBytes = normalized.size
    const sessionId = randomUUID()
    const storageKey = driveOverwriteStorageKeyForSession(asset.itemId, sessionId)
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.driveUploadSession.create({
        data: {
          id: sessionId,
          userId,
          itemId: asset.itemId,
          storageKey,
          expectedName: normalized.name,
          expectedSize: normalized.size,
          expectedMime: normalized.mimeType,
          reservedBytes,
          purpose: DRIVE_UPLOAD_PURPOSE.publicAssetReplace,
          publicAssetId: asset.id,
          replacePreviousStorageKey: asset.storageKey,
          status: DRIVE_UPLOAD_STATUS.pending,
          credentialKind: "presigned_put",
          expiresAt: new Date(Date.now() + driveUploadUrlTtlSeconds * 1000),
        },
      })
      await reserveDriveUsageBytes(tx, userId, reservedBytes)
      return { item: asset.item, session }
    })
    this.rememberPublicAppUrl(result.session.id, input.publicAppUrl)

    try {
      return await this.buildPrepareResult(result, normalized.mimeType)
    } catch (error) {
      await this.failSession(userId, result.session, DRIVE_UPLOAD_STATUS.failed, { preserveItem: true })
      throw error
    }
  }

  async completeReplace(userId: string, assetId: string, sessionId: string, auditContext: DriveAuditContext = {}): Promise<DrivePublicAssetDto> {
    const asset = await this.requireOwnedAsset(userId, assetId)
    const session = await this.requireUploadSession(userId, sessionId, DRIVE_UPLOAD_PURPOSE.publicAssetReplace)
    if (session.publicAssetId !== asset.id || session.itemId !== asset.itemId) throw new NotFoundException("上传会话不存在。")
    const publicAppUrl = auditContext.publicAppUrl ?? this.publicAppUrlsBySessionId.get(session.id) ?? "https://synapse.local"
    if (session.status === DRIVE_UPLOAD_STATUS.completed) return toDrivePublicAssetDto(asset, publicAppUrl)
    if (session.status !== DRIVE_UPLOAD_STATUS.pending) throw new NotFoundException("上传会话不存在。")
    await this.validateUploadedObject(session)
    const newEtag = await this.readObjectEtag(session.storageKey)

    try {
      const replaced = await this.prisma.$transaction(async (tx) => {
        const transitioned = await tx.driveUploadSession.updateMany({
          where: { id: session.id, userId, status: DRIVE_UPLOAD_STATUS.pending },
          data: { status: DRIVE_UPLOAD_STATUS.completed, completedAt: new Date() },
        })
        if (transitioned.count === 0) throw new NotFoundException("上传会话不存在。")
        await updateDriveUsageAfterCompletion(tx, userId, {
          reservedBytes: session.reservedBytes,
          usedBytesDelta: session.expectedSize,
        })
        await tx.publicAssetRevision.create({
          data: {
            assetId: asset.assetId,
            publicAssetId: asset.id,
            itemId: asset.itemId,
            storageKey: asset.storageKey,
            name: asset.name,
            originalName: asset.originalName,
            size: asset.size,
            mimeType: asset.mimeType,
            etag: asset.etag,
            replacedBy: userId,
          },
        })
        await tx.driveItem.update({
          where: { id: asset.itemId },
          data: {
            name: session.expectedName,
            size: session.expectedSize,
            mimeType: session.expectedMime,
            storageKey: session.storageKey,
            storageStatus: DRIVE_STORAGE_STATUS.active,
            uploadStatus: DRIVE_UPLOAD_STATUS.completed,
            objectMissing: false,
          },
        })
        return tx.publicAsset.update({
          where: { id: asset.id },
          data: {
            name: session.expectedName,
            originalName: session.expectedName,
            size: session.expectedSize,
            mimeType: session.expectedMime ?? asset.mimeType,
            storageKey: session.storageKey,
            etag: newEtag,
            lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
          },
          include: { item: true },
        })
      })
      await this.recordAuditSafely({
        userId,
        action: "drive.public_asset.replace.complete",
        targetType: "drive.publicAsset",
        targetId: asset.assetId,
        detail: { userId, sessionId: session.id, assetId: asset.assetId, itemId: asset.itemId, name: replaced.name },
        ipAddress: auditContext.ipAddress,
      })
      this.forgetPublicAppUrl(session.id)
      return toDrivePublicAssetDto(replaced, publicAppUrl)
    } catch (error) {
      const transitioned = await this.failSession(userId, session, DRIVE_UPLOAD_STATUS.failed, { preserveItem: true })
      if (!transitioned) {
        const latestSession = await this.findUploadSession(userId, session.id, DRIVE_UPLOAD_PURPOSE.publicAssetReplace)
        if (latestSession?.status === DRIVE_UPLOAD_STATUS.completed) {
          const current = await this.findAssetDtoForSession(userId, session, publicAppUrl)
          if (current) return current
        }
      }
      throw error
    }
  }

  async cancelReplace(userId: string, assetId: string, sessionId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const asset = await this.requireOwnedAsset(userId, assetId)
    const session = await this.requirePendingSession(userId, sessionId, DRIVE_UPLOAD_PURPOSE.publicAssetReplace)
    if (session.publicAssetId !== asset.id) throw new NotFoundException("上传会话不存在。")
    await this.failSession(userId, session, DRIVE_UPLOAD_STATUS.cancelled, { preserveItem: true })
    await this.recordAuditSafely({
      userId,
      action: "drive.public_asset.replace.cancel",
      targetType: "drive.publicAsset",
      targetId: asset.assetId,
      detail: { userId, sessionId: session.id, assetId },
      ipAddress: auditContext.ipAddress,
    })
    return { ok: true }
  }

  async renameAsset(userId: string, assetId: string, name: string, auditContext: DriveAuditContext = {}): Promise<DrivePublicAssetDto> {
    const normalizedName = normalizePublicAssetName(name)
    const asset = await this.requireOwnedAsset(userId, assetId)
    try {
      validatePublicAssetNameAndMime({ name: normalizedName, mimeType: asset.mimeType })
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "文件名无效。")
    }
    const renamed = await this.prisma.$transaction(async (tx) => {
      await tx.driveItem.update({ where: { id: asset.itemId }, data: { name: normalizedName } })
      return tx.publicAsset.update({
        where: { id: asset.id },
        data: { name: normalizedName },
        include: { item: true },
      })
    })
    await this.recordAuditSafely({
      userId,
      action: "drive.public_asset.rename",
      targetType: "drive.publicAsset",
      targetId: asset.assetId,
      detail: { userId, assetId, previousName: asset.name, nextName: normalizedName },
      ipAddress: auditContext.ipAddress,
    })
    return toDrivePublicAssetDto(renamed, resolveDtoPublicAppUrl(auditContext))
  }

  async trashAsset(userId: string, assetId: string, auditContext: DriveAuditContext = {}): Promise<DrivePublicAssetDto> {
    const asset = await this.requireOwnedAsset(userId, assetId)
    await this.lifecycleService().trashItem({
      userId,
      itemId: asset.itemId,
      actorId: userId,
      ipAddress: auditContext.ipAddress ?? "system",
      allowPublicAsset: true,
    })
    return toDrivePublicAssetDto(await this.requireOwnedAsset(userId, assetId, { includeTrashed: true }), resolveDtoPublicAppUrl(auditContext))
  }

  async restoreAsset(userId: string, assetId: string, auditContext: DriveAuditContext = {}): Promise<DrivePublicAssetDto> {
    const asset = await this.requireOwnedAsset(userId, assetId, { includeTrashed: true })
    await this.lifecycleService().restoreItem({
      userId,
      itemId: asset.itemId,
      actorId: userId,
      ipAddress: auditContext.ipAddress ?? "system",
      allowPublicAsset: true,
    })
    return toDrivePublicAssetDto(await this.requireOwnedAsset(userId, assetId), resolveDtoPublicAppUrl(auditContext))
  }

  async cleanupImportedAsset(userId: string, assetId: string, auditContext: DriveAuditContext = {}): Promise<{ readonly ok: true }> {
    const asset = await this.requireOwnedAsset(userId, assetId)
    const lifecycle = this.lifecycleService()
    await lifecycle.trashItem({
      userId,
      itemId: asset.itemId,
      actorId: userId,
      ipAddress: auditContext.ipAddress ?? "system",
      allowPublicAsset: true,
    })
    await lifecycle.hideTrashedItem({
      userId,
      itemId: asset.itemId,
      actorId: userId,
      ipAddress: auditContext.ipAddress ?? "system",
      allowPublicAsset: true,
    })
    return { ok: true }
  }

  async openAssetDownload(userId: string, assetId: string) {
    const asset = await this.requireOwnedAsset(userId, assetId)
    if (asset.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active || asset.item.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active) {
      throw new NotFoundException("公共资源不存在。")
    }
    const info = await this.storage.headObject(asset.storageKey)
    if (!info) {
      await this.markObjectMissing(asset)
      throw new NotFoundException("公共资源不存在。")
    }
    const object = await this.storage.getObjectStream({ key: asset.storageKey })
    return {
      stream: object.stream,
      fileName: asset.name,
      size: object.size ?? info.size,
      contentType: object.contentType ?? asset.mimeType,
    }
  }

  async resolvePublicAsset(assetId: string, requestHeaders: { readonly [key: string]: string | readonly string[] | undefined }): Promise<DriveResolvedPublicAsset> {
    if (!isDrivePublicAssetId(assetId)) return { status: "not_found", assetId }
    const asset = await this.prisma.publicAsset.findFirst({
      where: {
        assetId,
        deletedAt: null,
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
      },
      include: { item: true },
    }) as PublicAssetWithItem | null
    if (!asset || asset.item.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active) {
      return { status: "not_found", assetId }
    }
    if (asset.item.objectMissing) {
      await this.markObjectMissing(asset)
      return { status: "not_found", assetId }
    }
    const object = await this.storage.headObject(asset.storageKey)
    if (!object) {
      await this.markObjectMissing(asset)
      return { status: "not_found", assetId }
    }
    const etag = object.etag ?? asset.etag
    if (etag && requestMatchesEtag(requestHeaders["if-none-match"], etag)) {
      return {
        status: "not_modified",
        assetId,
        publicAssetId: asset.id,
        userId: asset.userId,
        etag,
      }
    }
    return {
      status: "ok",
      assetId,
      publicAssetId: asset.id,
      userId: asset.userId,
      storageKey: asset.storageKey,
      name: asset.name,
      mimeType: asset.mimeType,
      size: object.size,
      etag,
    }
  }

  async recordAccessSafely(input: DrivePublicAssetAccessInput): Promise<void> {
    if (!isDrivePublicAssetId(input.assetId)) return
    try {
      const bytes = input.bytes ?? 0n
      await this.prisma.$transaction(async (tx) => {
        await tx.publicAssetAccessLog.create({
          data: {
            assetId: input.assetId,
            publicAssetId: input.publicAssetId ?? null,
            userId: input.userId ?? null,
            ip: input.ip ?? null,
            referer: input.referer ? maskDriveBrowserUrl(input.referer) : null,
            userAgent: input.userAgent ?? null,
            method: input.method,
            statusCode: input.statusCode,
            bytes,
          },
        })
        if (input.publicAssetId && input.method.toUpperCase() === "GET" && (input.statusCode === 200 || input.statusCode === 304)) {
          await tx.publicAsset.update({
            where: { id: input.publicAssetId },
            data: {
              accessCount: { increment: 1n },
              responseBytes: bytes > 0n ? { increment: bytes } : undefined,
              lastAccessedAt: new Date(),
            },
          })
        }
      })
    } catch (error) {
      this.logger.warn({
        assetId: input.assetId,
        statusCode: input.statusCode,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Failed to record public asset access")
    }
  }

  private async buildPrepareResult(
    result: { readonly item: PublicAssetWithItem["item"]; readonly session: { readonly id: string; readonly storageKey: string; readonly expectedSize: bigint } },
    mimeType: string,
  ): Promise<DriveUploadPrepareResult> {
    const upload = await this.storage.createUploadInstruction({
      key: result.session.storageKey,
      contentType: mimeType,
      expectedSize: result.session.expectedSize,
    })
    return {
      sessionId: result.session.id,
      item: toDriveItemDto({ ...result.item, shares: [] }),
      upload: {
        method: upload.method,
        url: upload.url,
        expiresAt: upload.expiresAt.toISOString(),
        headers: upload.headers,
      },
    }
  }

  private rememberPublicAppUrl(sessionId: string, publicAppUrl: string | undefined): void {
    if (!publicAppUrl) return
    this.publicAppUrlsBySessionId.set(sessionId, publicAppUrl)
    this.lifecycle?.registerUploadSessionCleanup(sessionId, () => {
      this.publicAppUrlsBySessionId.delete(sessionId)
    })
  }

  private forgetPublicAppUrl(sessionId: string): void {
    this.publicAppUrlsBySessionId.delete(sessionId)
    this.lifecycle?.forgetUploadSessionCleanup(sessionId)
  }

  private async createAssetWithRetry(userId: string, session: PublicAssetUploadSession): Promise<PublicAssetWithItem> {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const assetId = createDrivePublicAssetId()
      try {
        const etag = await this.readObjectEtag(session.storageKey)
        return await this.prisma.$transaction(async (tx) => {
          const transitioned = await tx.driveUploadSession.updateMany({
            where: { id: session.id, userId, status: DRIVE_UPLOAD_STATUS.pending },
            data: { status: DRIVE_UPLOAD_STATUS.completed, completedAt: new Date() },
          })
          if (transitioned.count === 0) throw new NotFoundException("上传会话不存在。")
          await updateDriveUsageAfterCompletion(tx, userId, {
            reservedBytes: session.reservedBytes,
            usedBytesDelta: session.expectedSize,
          })
          await tx.driveItem.update({
            where: { id: session.itemId },
            data: {
              name: session.expectedName,
              size: session.expectedSize,
              mimeType: session.expectedMime,
              storageKey: session.storageKey,
              storageStatus: DRIVE_STORAGE_STATUS.active,
              uploadStatus: DRIVE_UPLOAD_STATUS.completed,
              objectMissing: false,
            },
          })
          return tx.publicAsset.create({
            data: {
              assetId,
              userId,
              itemId: session.itemId,
              name: session.expectedName,
              originalName: session.expectedName,
              size: session.expectedSize,
              mimeType: session.expectedMime ?? "application/octet-stream",
              storageKey: session.storageKey,
              etag,
            },
            include: { item: true },
          })
        })
      } catch (error) {
        if (!isUniqueConstraintError(error, "assetId")) throw error
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Failed to allocate public asset id.")
  }

  private async validateUploadedObject(session: PublicAssetUploadSession): Promise<void> {
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.failSession(session.userId, session, DRIVE_UPLOAD_STATUS.expired, { preserveItem: session.purpose === DRIVE_UPLOAD_PURPOSE.publicAssetReplace })
      throw new BadRequestException("上传会话已过期。")
    }
    const object = await this.storage.headObject(session.storageKey)
    if (!object || object.size !== session.expectedSize) {
      await this.failSession(session.userId, session, DRIVE_UPLOAD_STATUS.failed, { preserveItem: session.purpose === DRIVE_UPLOAD_PURPOSE.publicAssetReplace })
      throw new BadRequestException("上传文件校验失败。")
    }
    const bytes = await readObjectPrefix(this.storage, session.storageKey)
    if (!session.expectedMime || !matchesPublicAssetContentSignature(bytes, session.expectedMime)) {
      await this.failSession(session.userId, session, DRIVE_UPLOAD_STATUS.failed, { preserveItem: session.purpose === DRIVE_UPLOAD_PURPOSE.publicAssetReplace })
      throw new BadRequestException("上传文件校验失败。")
    }
  }

  private async requireUploadSession(userId: string, sessionId: string, purpose: string): Promise<PublicAssetUploadSession> {
    const session = await this.prisma.driveUploadSession.findFirst({
      where: { id: sessionId, userId, purpose },
      include: { item: true },
    }) as PublicAssetUploadSession | null
    if (!session) throw new NotFoundException("上传会话不存在。")
    return session
  }

  private async requirePendingSession(userId: string, sessionId: string, purpose: string): Promise<PublicAssetUploadSession> {
    const session = await this.requireUploadSession(userId, sessionId, purpose)
    if (!session || session.status !== DRIVE_UPLOAD_STATUS.pending) throw new NotFoundException("上传会话不存在。")
    return session
  }

  private async requireOwnedAsset(
    userId: string,
    assetId: string,
    options: { readonly includeTrashed?: boolean; readonly includeMissing?: boolean } = {},
  ): Promise<PublicAssetWithItem> {
    if (!isDrivePublicAssetId(assetId)) throw new NotFoundException("公共资源不存在。")
    const lifecycleStatuses = [
      DRIVE_ITEM_LIFECYCLE_STATUS.active,
      ...(options.includeTrashed ? [DRIVE_ITEM_LIFECYCLE_STATUS.trashed] : []),
      ...(options.includeMissing ? [DRIVE_ITEM_LIFECYCLE_STATUS.legacyMissing] : []),
    ]
    const asset = await this.prisma.publicAsset.findFirst({
      where: {
        userId,
        assetId,
        deletedAt: null,
        lifecycleStatus: { in: lifecycleStatuses },
      },
      include: { item: true },
    }) as PublicAssetWithItem | null
    if (!asset) throw new NotFoundException("公共资源不存在。")
    return asset
  }

  private async requireActivePublicAsset(assetId: string): Promise<PublicAssetWithItem> {
    if (!isDrivePublicAssetId(assetId)) throw new NotFoundException("公共资源不存在。")
    const asset = await this.prisma.publicAsset.findFirst({
      where: {
        assetId,
        deletedAt: null,
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
      },
      include: { item: true },
    }) as PublicAssetWithItem | null
    if (!asset || asset.item.lifecycleStatus !== DRIVE_ITEM_LIFECYCLE_STATUS.active) throw new NotFoundException("公共资源不存在。")
    return asset
  }

  private assertPublicAssetId(assetId: string): void {
    if (!isDrivePublicAssetId(assetId)) throw new BadRequestException("公共资源 ID 无效。")
  }

  private async requireAdminAsset(assetId: string): Promise<void> {
    const asset = await this.prisma.publicAsset.findFirst({
      where: { assetId, deletedAt: null },
      select: { id: true },
    })
    if (!asset) throw new NotFoundException("公共资源不存在。")
  }

  private async failSession(
    userId: string,
    session: Pick<PublicAssetUploadSession, "id" | "itemId" | "reservedBytes" | "storageKey">,
    status: string,
    options: { readonly preserveItem?: boolean } = {},
  ): Promise<boolean> {
    let transitioned = false
    await this.prisma.$transaction(async (tx) => {
      const transition = await tx.driveUploadSession.updateMany({
        where: { id: session.id, userId, status: DRIVE_UPLOAD_STATUS.pending },
        data: { status, failedAt: new Date() },
      })
      if (transition.count === 0) return
      transitioned = true
      if (session.reservedBytes > 0n) {
        await tx.driveUsage.update({
          where: { userId },
          data: { reservedBytes: { decrement: session.reservedBytes } },
        })
      }
      if (!options.preserveItem) {
        await tx.driveItem.update({
          where: { id: session.itemId },
          data: {
            storageStatus: status === DRIVE_UPLOAD_STATUS.cancelled ? DRIVE_STORAGE_STATUS.deleted : DRIVE_STORAGE_STATUS.failed,
            uploadStatus: status,
            deletedAt: new Date(),
          },
        })
      }
    })
    if (!transitioned) return false
    this.forgetPublicAppUrl(session.id)
    if (await this.isStorageKeyPublished(session.storageKey)) return true
    await this.deleteObjectSafely(session.storageKey)
    return true
  }

  private async failSessionSafely(
    userId: string,
    session: Pick<PublicAssetUploadSession, "id" | "itemId" | "reservedBytes" | "storageKey">,
  ): Promise<void> {
    try {
      await this.failSession(userId, session, DRIVE_UPLOAD_STATUS.failed)
    } catch (error) {
      this.logger.warn({
        sessionId: session.id,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Failed to rollback public asset import session")
    }
  }

  private async readObjectEtag(storageKey: string): Promise<string | null> {
    const object = await this.storage.headObject(storageKey)
    return object?.etag ?? null
  }

  private async findAssetDtoForSession(userId: string, session: Pick<PublicAssetUploadSession, "itemId">, publicAppUrl: string): Promise<DrivePublicAssetDto | null> {
    const asset = await this.prisma.publicAsset.findFirst({
      where: { userId, itemId: session.itemId, deletedAt: null },
      include: { item: true },
    }) as PublicAssetWithItem | null
    return asset ? toDrivePublicAssetDto(asset, publicAppUrl) : null
  }

  private async findUploadSession(userId: string, sessionId: string, purpose: string): Promise<PublicAssetUploadSession | null> {
    return this.prisma.driveUploadSession.findFirst({
      where: { id: sessionId, userId, purpose },
    }) as Promise<PublicAssetUploadSession | null>
  }

  private async isStorageKeyPublished(storageKey: string): Promise<boolean> {
    const asset = await this.prisma.publicAsset.findFirst({
      where: { storageKey, deletedAt: null },
      include: { item: true },
    }) as PublicAssetWithItem | null
    if (asset) return true
    const item = await this.prisma.driveItem.findFirst({
      where: {
        storageKey,
        deletedAt: null,
        storageStatus: DRIVE_STORAGE_STATUS.active,
        uploadStatus: DRIVE_UPLOAD_STATUS.completed,
      },
    })
    return Boolean(item)
  }

  private async markObjectMissing(asset: PublicAssetWithItem): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.driveItem.update({ where: { id: asset.itemId }, data: { objectMissing: true } }),
        this.prisma.publicAsset.updateMany({
          where: { id: asset.id, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active },
          data: { lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.legacyMissing },
        }),
      ])
    } catch (error) {
      this.logger.warn({
        assetId: asset.assetId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Failed to mark public asset object missing")
    }
  }

  private async deleteObjectSafely(storageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey)
    } catch (error) {
      this.logger.warn({
        storageKeyLength: storageKey.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Failed to delete public asset object")
    }
  }

  private async recordAuditSafely(input: {
    readonly userId: string
    readonly action: string
    readonly targetType: string
    readonly targetId: string
    readonly detail: Record<string, unknown>
    readonly ipAddress?: string
  }): Promise<void> {
    if (!this.auditLog) return
    try {
      const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } })
      await this.auditLog.record({
        adminEmail: user?.email ?? input.userId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: input.detail,
        ipAddress: input.ipAddress ?? "system",
      })
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetId: input.targetId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Failed to record public asset audit log")
    }
  }

  private lifecycleService(): DriveLifecycleService {
    return this.lifecycle ?? new DriveLifecycleService(this.prisma, this.storage, this.auditLog)
  }
}

function normalizePublicAssetUploadInput(input: DrivePublicAssetPrepareUploadInput): { readonly name: string; readonly size: bigint; readonly mimeType: string } {
  const name = normalizePublicAssetName(input.name)
  const size = parseRequestedSize(input.size)
  if (size > drivePublicAssetMaxFileBytes) throw new PayloadTooLargeException(`文件超过 ${DRIVE_MAX_FILE_SIZE_LABEL} 限制。`)
  let policy: ReturnType<typeof validatePublicAssetNameAndMime>
  try {
    policy = validatePublicAssetNameAndMime({ name, mimeType: input.mimeType ?? null })
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE)
  }
  return { name, size, mimeType: policy.mimeType }
}

function resolveDtoPublicAppUrl(auditContext: DriveAuditContext): string {
  return auditContext.publicAppUrl ?? "https://synapse.local"
}

function normalizePublicAssetName(value: string): string {
  const name = value.normalize("NFC")
  if (!isValidDriveItemName(name)) throw new BadRequestException("文件名无效。")
  return name
}

function parseRequestedSize(value: string): bigint {
  if (!/^\d+$/u.test(value)) throw new BadRequestException("文件大小无效。")
  const size = BigInt(value)
  if (size <= 0n) throw new BadRequestException("文件大小无效。")
  return size
}

async function updateDriveUsageAfterCompletion(
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

async function readObjectPrefix(storage: DriveStoragePort, storageKey: string): Promise<Buffer> {
  const object = await storage.getObjectStream({ key: storageKey })
  const stream = object.stream as Readable
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    chunks.push(buffer)
    total += buffer.length
    if (total >= PUBLIC_ASSET_SIGNATURE_READ_BYTES) break
  }
  return Buffer.concat(chunks).subarray(0, PUBLIC_ASSET_SIGNATURE_READ_BYTES)
}

function requestMatchesEtag(value: string | readonly string[] | undefined, etag: string): boolean {
  const raw = typeof value === "string" ? value : value?.join(",")
  if (!raw) return false
  return raw.split(",").map((entry: string) => entry.trim()).some((entry: string) => entry === "*" || entry === etag)
}

function normalizePublicAssetPage(input: DrivePublicAssetListInput): { readonly offset: number; readonly limit: number } {
  const offset = typeof input.offset === "number" && Number.isFinite(input.offset) && input.offset > 0 ? Math.floor(input.offset) : 0
  const requestedLimit = typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : PUBLIC_ASSET_LIST_DEFAULT_LIMIT
  return { offset, limit: Math.min(requestedLimit, PUBLIC_ASSET_LIST_MAX_LIMIT) }
}

function isUniqueConstraintError(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false
  const target = error.meta?.target
  return Array.isArray(target) && target.includes(field)
}
