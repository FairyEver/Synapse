import { BadRequestException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma } from "@prisma/client"
import {
  DRIVE_DOCUMENT_IMAGE_MAX_BYTES,
  DRIVE_DOCUMENT_IMAGE_MAX_SIZE_LABEL,
  DRIVE_PUBLIC_ASSET_IMAGE_UNSUPPORTED_FORMAT_MESSAGE,
  PLATFORM_OBJECT_PATH_PREFIX,
  drivePublicAssetContentKind,
  isDriveDocumentImageId,
  type DriveDocumentImageUploadPrepareResult,
  type DriveHostedDocumentImageDto,
} from "@synapse/shared"
import { formatAuditError } from "../common/audit-error"
import { toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"
import { driveUploadUrlTtlSeconds } from "./drive.constants"
import { extractDriveMarkdownImages } from "./drive-document-image-parser"
import { matchesPublicAssetContentSignature, validatePublicAssetNameAndMime } from "./drive-public-asset-policy"
import { createDriveDocumentImageId } from "./drive-token"
import { PlatformMediaStorage, type PlatformMediaStoragePort } from "./platform-media-storage"

type DrivePrismaClient = PrismaService | Prisma.TransactionClient

export const DOCUMENT_IMAGE_STATUS = {
  temporary: "temporary",
  active: "active",
  quarantined: "quarantined",
  deletePending: "delete_pending",
  deleted: "deleted",
} as const

const DOCUMENT_IMAGE_UPLOAD_STATUS = {
  pending: "pending",
  completed: "completed",
  cancelled: "cancelled",
  expired: "expired",
  failed: "failed",
} as const

const DOCUMENT_IMAGE_TEMPORARY_TTL_MS = 24 * 60 * 60 * 1000
const DOCUMENT_IMAGE_SIGNATURE_READ_BYTES = 4096

@Injectable()
export class DriveDocumentHostedImageService {
  private readonly logger = new Logger(DriveDocumentHostedImageService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PlatformMediaStorage,
  ) {}

  async prepareUpload(input: {
    readonly actorUserId: string
    readonly sourceItemId: string
    readonly name: string
    readonly size: string
    readonly mimeType: string
  }): Promise<DriveDocumentImageUploadPrepareResult> {
    const size = parseImageSize(input.size)
    const policy = validateDocumentImage(input.name, input.mimeType)
    const imageId = createDriveDocumentImageId()
    const storageKey = `document-images/${imageId}`
    const session = await this.prisma.documentImageUploadSession.create({
      data: {
        imageId,
        actorUserId: input.actorUserId,
        sourceItemId: input.sourceItemId,
        storageKey,
        expectedName: normalizeImageName(input.name, policy.mimeType),
        expectedSize: size,
        expectedMime: policy.mimeType,
        status: DOCUMENT_IMAGE_UPLOAD_STATUS.pending,
        expiresAt: new Date(Date.now() + driveUploadUrlTtlSeconds * 1000),
      },
    })
    try {
      const upload = await this.storage.createUploadInstruction({ key: storageKey, contentType: policy.mimeType, expectedSize: size })
      return {
        sessionId: session.id,
        imageId,
        upload: {
          method: upload.method,
          url: upload.url,
          expiresAt: upload.expiresAt.toISOString(),
          headers: upload.headers,
        },
      }
    } catch (error) {
      await this.prisma.documentImageUploadSession.update({
        where: { id: session.id },
        data: { status: DOCUMENT_IMAGE_UPLOAD_STATUS.failed, failedAt: new Date() },
      })
      throw error
    }
  }

  async completeUpload(input: {
    readonly actorUserId: string
    readonly sourceItemId: string
    readonly sessionId: string
  }): Promise<DriveHostedDocumentImageDto> {
    const session = await this.requirePendingSession(input)
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.failSession(session, DOCUMENT_IMAGE_UPLOAD_STATUS.expired)
      throw new BadRequestException("上传会话已过期。")
    }
    const object = await this.storage.headObject(session.storageKey)
    if (!object || object.size !== session.expectedSize) {
      await this.failSession(session, DOCUMENT_IMAGE_UPLOAD_STATUS.failed)
      throw new BadRequestException("上传文件校验失败。")
    }
    const prefix = await readObjectPrefix(this.storage, session.storageKey)
    if (!matchesPublicAssetContentSignature(prefix, session.expectedMime)) {
      await this.failSession(session, DOCUMENT_IMAGE_UPLOAD_STATUS.failed)
      throw new BadRequestException("图片内容与声明格式不匹配。")
    }
    const now = new Date()
    const image = await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.documentImageUploadSession.updateMany({
        where: { id: session.id, actorUserId: input.actorUserId, sourceItemId: input.sourceItemId, status: DOCUMENT_IMAGE_UPLOAD_STATUS.pending },
        data: { status: DOCUMENT_IMAGE_UPLOAD_STATUS.completed, completedAt: now },
      })
      if (transitioned.count !== 1) throw new NotFoundException("上传会话不存在。")
      const created = await tx.documentHostedImage.create({
        data: {
          imageId: session.imageId,
          uploadedByUserId: input.actorUserId,
          sourceItemId: input.sourceItemId,
          originalName: session.expectedName,
          size: session.expectedSize,
          mimeType: session.expectedMime,
          storageKey: session.storageKey,
          etag: object.etag ?? null,
          status: DOCUMENT_IMAGE_STATUS.temporary,
          expiresAt: new Date(now.getTime() + DOCUMENT_IMAGE_TEMPORARY_TTL_MS),
        },
      })
      await tx.documentImageUploadSession.delete({ where: { id: session.id } })
      return created
    })
    return toDocumentImageDto(image)
  }

  async cancelUpload(input: { readonly actorUserId: string; readonly sourceItemId: string; readonly sessionId: string }): Promise<{ readonly ok: true }> {
    const session = await this.requirePendingSession(input)
    const transitioned = await this.prisma.documentImageUploadSession.updateMany({
      where: { id: session.id, status: DOCUMENT_IMAGE_UPLOAD_STATUS.pending },
      data: { status: DOCUMENT_IMAGE_UPLOAD_STATUS.cancelled, failedAt: new Date() },
    })
    if (transitioned.count !== 1) throw new NotFoundException("上传会话不存在。")
    await this.cleanupUploadSessionObject(session)
    return { ok: true }
  }

  async activateReferencedImages(tx: Prisma.TransactionClient, input: { readonly sourceItemId: string; readonly markdown: string }): Promise<void> {
    const imageIds = extractHostedImageIds(input.markdown)
    if (imageIds.length === 0) return
    await tx.documentHostedImage.updateMany({
      where: {
        imageId: { in: imageIds },
        sourceItemId: input.sourceItemId,
        status: DOCUMENT_IMAGE_STATUS.temporary,
        expiresAt: { gt: new Date() },
      },
      data: { status: DOCUMENT_IMAGE_STATUS.active, expiresAt: null, activatedAt: new Date() },
    })
  }

  async resolveImage(imageId: string): Promise<{
    readonly storageKey: string
    readonly name: string
    readonly size: bigint
    readonly mimeType: string
    readonly etag: string | null
  } | null> {
    if (!isDriveDocumentImageId(imageId)) return null
    const now = new Date()
    const image = await this.prisma.documentHostedImage.findFirst({
      where: {
        imageId,
        deletedAt: null,
        deletePending: false,
        OR: [
          { status: DOCUMENT_IMAGE_STATUS.active },
          { status: DOCUMENT_IMAGE_STATUS.temporary, expiresAt: { gt: now } },
        ],
      },
    })
    if (!image) return null
    const object = await this.storage.headObject(image.storageKey)
    if (!object) return null
    return {
      storageKey: image.storageKey,
      name: image.originalName,
      size: object.size,
      mimeType: image.mimeType,
      etag: object.etag ?? image.etag,
    }
  }

  openImage(storageKey: string) {
    return this.storage.getObjectStream(storageKey)
  }

  async listAdminImages(input: {
    readonly pagination: PaginationQuery
    readonly search?: string
    readonly status?: string
  }): Promise<PaginatedResponse<AdminDocumentHostedImageRow>> {
    const where: Prisma.DocumentHostedImageWhereInput = {
      deletedAt: null,
      ...(input.status ? { status: input.status } : {}),
      ...(input.search ? {
        OR: [
          { imageId: { contains: input.search, mode: "insensitive" } },
          { originalName: { contains: input.search, mode: "insensitive" } },
          { uploadedBy: { email: { contains: input.search, mode: "insensitive" } } },
        ],
      } : {}),
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.documentHostedImage.findMany({
        ...toPrismaArgs(input.pagination),
        where,
        include: {
          uploadedBy: { select: { email: true } },
          sourceItem: { select: { name: true } },
        },
      }),
      this.prisma.documentHostedImage.count({ where }),
    ])
    return {
      data: data.map(toAdminDocumentImageRow),
      total,
      page: input.pagination.page,
      pageSize: input.pagination.pageSize,
    }
  }

  async quarantineImage(imageId: string, adminEmail: string): Promise<AdminDocumentHostedImageRow> {
    const image = await this.requireAdminImage(imageId)
    if (image.status === DOCUMENT_IMAGE_STATUS.quarantined) return toAdminDocumentImageRow(image)
    if (image.status === DOCUMENT_IMAGE_STATUS.deletePending) throw new BadRequestException("图片正在删除。")
    return toAdminDocumentImageRow(await this.prisma.documentHostedImage.update({
      where: { id: image.id },
      data: { status: DOCUMENT_IMAGE_STATUS.quarantined, quarantinedAt: new Date(), quarantinedBy: adminEmail },
      include: { uploadedBy: { select: { email: true } }, sourceItem: { select: { name: true } } },
    }))
  }

  async restoreImage(imageId: string): Promise<AdminDocumentHostedImageRow> {
    const image = await this.requireAdminImage(imageId)
    if (image.status !== DOCUMENT_IMAGE_STATUS.quarantined) throw new BadRequestException("只有已隔离图片可以恢复。")
    return toAdminDocumentImageRow(await this.prisma.documentHostedImage.update({
      where: { id: image.id },
      data: { status: DOCUMENT_IMAGE_STATUS.active, quarantinedAt: null, quarantinedBy: null, expiresAt: null },
      include: { uploadedBy: { select: { email: true } }, sourceItem: { select: { name: true } } },
    }))
  }

  async deleteImage(imageId: string, adminEmail: string): Promise<{ readonly ok: true; readonly deletePending?: true }> {
    const image = await this.requireAdminImage(imageId)
    if (image.status !== DOCUMENT_IMAGE_STATUS.quarantined) throw new BadRequestException("请先隔离图片。")
    await this.deleteImageObject(image.id, image.imageId, image.storageKey, adminEmail)
    const current = await this.prisma.documentHostedImage.findUnique({ where: { id: image.id }, select: { deletePending: true } })
    return current?.deletePending ? { ok: true, deletePending: true } : { ok: true }
  }

  async resolveAdminImage(imageId: string) {
    const image = await this.requireAdminImage(imageId)
    const object = await this.storage.headObject(image.storageKey)
    if (!object) throw new NotFoundException("图片不存在。")
    return { storageKey: image.storageKey, name: image.originalName, mimeType: image.mimeType, size: object.size }
  }

  async getStorageSummary(): Promise<{ readonly count: number; readonly bytes: string }> {
    const aggregate = await this.prisma.documentHostedImage.aggregate({
      where: { deletedAt: null },
      _count: { _all: true },
      _sum: { size: true },
    })
    return { count: aggregate._count._all, bytes: (aggregate._sum.size ?? 0n).toString() }
  }

  @Cron("*/15 * * * *")
  async scheduledCleanup(): Promise<void> {
    try {
      await this.cleanupExpired()
      await this.retryUploadSessionCleanup()
      await this.retryPendingDeletes()
    } catch (error) {
      this.logger.warn({
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Document hosted image cleanup failed")
    }
  }

  async cleanupExpired(now = new Date()): Promise<void> {
    const sessions = await this.prisma.documentImageUploadSession.findMany({
      where: { status: DOCUMENT_IMAGE_UPLOAD_STATUS.pending, expiresAt: { lte: now } },
    })
    for (const session of sessions) await this.failSession(session, DOCUMENT_IMAGE_UPLOAD_STATUS.expired)
    const images = await this.prisma.documentHostedImage.findMany({
      where: { status: DOCUMENT_IMAGE_STATUS.temporary, expiresAt: { lte: now }, deletedAt: null },
    })
    for (const image of images) await this.deleteImageObject(image.id, image.imageId, image.storageKey, "system")
  }

  async retryPendingDeletes(): Promise<void> {
    const images = await this.prisma.documentHostedImage.findMany({ where: { deletePending: true, deletedAt: null }, take: 100 })
    for (const image of images) await this.deleteImageObject(image.id, image.imageId, image.storageKey, image.deletedBy ?? "system")
  }

  private async retryUploadSessionCleanup(): Promise<void> {
    const sessions = await this.prisma.documentImageUploadSession.findMany({
      where: { status: { in: [DOCUMENT_IMAGE_UPLOAD_STATUS.cancelled, DOCUMENT_IMAGE_UPLOAD_STATUS.expired, DOCUMENT_IMAGE_UPLOAD_STATUS.failed] } },
      take: 100,
    })
    for (const session of sessions) await this.cleanupUploadSessionObject(session)
  }

  private async requirePendingSession(input: { readonly actorUserId: string; readonly sourceItemId: string; readonly sessionId: string }) {
    const session = await this.prisma.documentImageUploadSession.findFirst({
      where: {
        id: input.sessionId,
        actorUserId: input.actorUserId,
        sourceItemId: input.sourceItemId,
        status: DOCUMENT_IMAGE_UPLOAD_STATUS.pending,
      },
    })
    if (!session) throw new NotFoundException("上传会话不存在。")
    return session
  }

  private async requireAdminImage(imageId: string) {
    if (!isDriveDocumentImageId(imageId)) throw new NotFoundException("图片不存在。")
    const image = await this.prisma.documentHostedImage.findFirst({
      where: { imageId, deletedAt: null },
      include: { uploadedBy: { select: { email: true } }, sourceItem: { select: { name: true } } },
    })
    if (!image) throw new NotFoundException("图片不存在。")
    return image
  }

  private async failSession(session: { readonly id: string; readonly imageId: string; readonly storageKey: string }, status: string): Promise<void> {
    const transitioned = await this.prisma.documentImageUploadSession.updateMany({
      where: { id: session.id, status: DOCUMENT_IMAGE_UPLOAD_STATUS.pending },
      data: { status, failedAt: new Date() },
    })
    if (transitioned.count === 1) await this.cleanupUploadSessionObject(session)
  }

  private async deleteImageObject(id: string, imageId: string, storageKey: string, deletedBy: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey)
      await this.prisma.documentHostedImage.update({
        where: { id },
        data: { status: DOCUMENT_IMAGE_STATUS.deleted, deletePending: false, deletedAt: new Date(), deletedBy },
      })
    } catch (error) {
      await this.prisma.documentHostedImage.update({
        where: { id },
        data: { status: DOCUMENT_IMAGE_STATUS.deletePending, deletePending: true, deletedBy },
      })
      this.logger.warn({ imageId, errorMessage: formatAuditError(error) }, "Document hosted image delete failed")
    }
  }

  private async cleanupUploadSessionObject(session: { readonly id: string; readonly storageKey: string; readonly imageId: string }): Promise<void> {
    try {
      await this.storage.deleteObject(session.storageKey)
      await this.prisma.documentImageUploadSession.deleteMany({ where: { id: session.id, status: { not: DOCUMENT_IMAGE_UPLOAD_STATUS.pending } } })
    } catch (error) {
      this.logger.warn({ imageId: session.imageId, errorMessage: formatAuditError(error) }, "Document hosted image upload cleanup failed")
    }
  }
}

export type AdminDocumentHostedImageRow = {
  readonly imageId: string
  readonly name: string
  readonly size: string
  readonly mimeType: string
  readonly status: string
  readonly uploaderEmail: string | null
  readonly sourceItemName: string | null
  readonly createdAt: string
  readonly activatedAt: string | null
  readonly quarantinedAt: string | null
}

function toAdminDocumentImageRow(image: {
  readonly imageId: string
  readonly originalName: string
  readonly size: bigint
  readonly mimeType: string
  readonly status: string
  readonly uploadedBy?: { readonly email: string } | null
  readonly sourceItem?: { readonly name: string } | null
  readonly createdAt: Date
  readonly activatedAt: Date | null
  readonly quarantinedAt: Date | null
}): AdminDocumentHostedImageRow {
  return {
    imageId: image.imageId,
    name: image.originalName,
    size: image.size.toString(),
    mimeType: image.mimeType,
    status: image.status,
    uploaderEmail: image.uploadedBy?.email ?? null,
    sourceItemName: image.sourceItem?.name ?? null,
    createdAt: image.createdAt.toISOString(),
    activatedAt: image.activatedAt?.toISOString() ?? null,
    quarantinedAt: image.quarantinedAt?.toISOString() ?? null,
  }
}

function parseImageSize(value: string): bigint {
  if (!/^\d+$/u.test(value)) throw new BadRequestException("图片大小无效。")
  const size = BigInt(value)
  if (size <= 0n) throw new BadRequestException("图片内容为空。")
  if (size > BigInt(DRIVE_DOCUMENT_IMAGE_MAX_BYTES)) throw new PayloadTooLargeException(`图片超过 ${DRIVE_DOCUMENT_IMAGE_MAX_SIZE_LABEL} 限制。`)
  return size
}

function validateDocumentImage(name: string, mimeType: string) {
  try {
    const policy = validatePublicAssetNameAndMime({ name, mimeType })
    if (drivePublicAssetContentKind(policy.mimeType) !== "image") throw new Error(DRIVE_PUBLIC_ASSET_IMAGE_UNSUPPORTED_FORMAT_MESSAGE)
    return policy
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : DRIVE_PUBLIC_ASSET_IMAGE_UNSUPPORTED_FORMAT_MESSAGE)
  }
}

function normalizeImageName(name: string, mimeType: string): string {
  const normalized = name.trim().slice(0, 255)
  if (normalized) return normalized
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] ?? "png"
  return `image.${extension}`
}

function extractHostedImageIds(markdown: string): string[] {
  const appPublicUrl = process.env.APP_PUBLIC_URL?.trim()
  const configuredOrigin = appPublicUrl ? new URL(appPublicUrl).origin : null
  const ids = new Set<string>()
  for (const image of extractDriveMarkdownImages(markdown)) {
    const src = image.src.trim()
    try {
      const url = new URL(src, "https://relative.invalid")
      if (!src.startsWith("/") && configuredOrigin && url.origin !== configuredOrigin) continue
      const prefix = `${PLATFORM_OBJECT_PATH_PREFIX}/`
      if (!url.pathname.startsWith(prefix)) continue
      const imageId = decodeURIComponent(url.pathname.slice(prefix.length))
      if (!imageId.includes("/") && isDriveDocumentImageId(imageId)) ids.add(imageId)
    } catch {
      continue
    }
  }
  return [...ids]
}

async function readObjectPrefix(storage: PlatformMediaStoragePort, key: string): Promise<Buffer> {
  const object = await storage.getObjectStream(key)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of object.stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const remaining = DOCUMENT_IMAGE_SIGNATURE_READ_BYTES - size
    if (remaining <= 0) break
    chunks.push(buffer.subarray(0, remaining))
    size += Math.min(buffer.length, remaining)
    if (size >= DOCUMENT_IMAGE_SIGNATURE_READ_BYTES) break
  }
  if ("destroy" in object.stream && typeof object.stream.destroy === "function") object.stream.destroy()
  return Buffer.concat(chunks)
}

function toDocumentImageDto(image: {
  readonly imageId: string
  readonly originalName: string
  readonly size: bigint
  readonly mimeType: string
}): DriveHostedDocumentImageDto {
  return {
    imageId: image.imageId,
    name: image.originalName,
    size: image.size.toString(),
    mimeType: image.mimeType,
    url: `${PLATFORM_OBJECT_PATH_PREFIX}/${encodeURIComponent(image.imageId)}`,
  }
}
