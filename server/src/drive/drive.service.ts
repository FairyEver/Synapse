import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {
  buildDriveShareUrl,
  type DriveFolderUploadPrepareResult,
  type DriveItemDto,
  type DriveShareDto,
  type DriveUploadPrepareResult,
  type DriveUsageDto,
} from "@synapse/shared"
import { AuditLogService } from "../common/audit-log.service"
import { toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { PrismaService } from "../prisma/prisma.service"
import {
  DRIVE_ITEM_TYPE,
  DRIVE_STORAGE_STATUS,
  DRIVE_UPLOAD_STATUS,
  driveDefaultQuotaBytes,
  driveMaxFileBytes,
  driveUploadUrlTtlSeconds,
} from "./drive.constants"
import { createDriveShareId, driveStorageKeyForItem, isValidDriveItemName } from "./drive-token"
import type { DriveStoragePort } from "./drive-storage"
import {
  toDriveItemDto,
  type DriveAdminFilters,
  type DriveAdminItemDto,
  type DrivePrepareFolderUploadInput,
  type DrivePrepareUploadInput,
} from "./drive.types"

type DrivePrismaClient = PrismaService | Prisma.TransactionClient

const driveItemWithShares = {
  shares: {
    where: { enabled: true },
    select: { id: true, enabled: true },
  },
} as const

@Injectable()
export class DriveService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

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

    const upload = await this.storage.createUploadInstruction({
      key: result.session.storageKey,
      contentType: input.mimeType ?? undefined,
    })
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

  async prepareFolderUpload(userId: string, input: DrivePrepareFolderUploadInput): Promise<DriveFolderUploadPrepareResult> {
    if (input.files.length === 0) throw new BadRequestException("文件夹不能为空。")
    const root = await this.createFolder(userId, { parentId: input.parentId, name: input.folderName })
    const folderIdsByPath = new Map<string, string>([["", root.id]])
    const entries: DriveFolderUploadPrepareResult["entries"] = []

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
        const folder = await this.createFolder(userId, { parentId, name: folderName })
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
  }

  async completeUpload(userId: string, sessionId: string): Promise<DriveItemDto> {
    const session = await this.prisma.driveUploadSession.findFirst({
      where: { id: sessionId, userId, status: DRIVE_UPLOAD_STATUS.pending },
      include: { item: { include: driveItemWithShares } },
    })
    if (!session || session.item.deletedAt) throw new NotFoundException("上传会话不存在。")
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.failUploadSession(userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.expired)
      throw new BadRequestException("上传会话已过期。")
    }
    const object = await this.storage.headObject(session.storageKey)
    if (!object || object.size !== session.expectedSize) {
      await this.failUploadSession(userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.failed)
      throw new BadRequestException("上传文件校验失败。")
    }

    const item = await this.prisma.$transaction(async (tx) => {
      await tx.driveUploadSession.update({
        where: { id: session.id },
        data: { status: DRIVE_UPLOAD_STATUS.completed, completedAt: new Date() },
      })
      await tx.driveUsage.update({
        where: { userId },
        data: {
          reservedBytes: { decrement: session.expectedSize },
          usedBytes: { increment: session.expectedSize },
        },
      })
      return tx.driveItem.update({
        where: { id: session.itemId },
        data: {
          storageStatus: DRIVE_STORAGE_STATUS.active,
          uploadStatus: DRIVE_UPLOAD_STATUS.completed,
        },
        include: driveItemWithShares,
      })
    })
    return toDriveItemDto(item)
  }

  async cancelUpload(userId: string, sessionId: string): Promise<{ readonly ok: true }> {
    const session = await this.prisma.driveUploadSession.findFirst({
      where: { id: sessionId, userId, status: DRIVE_UPLOAD_STATUS.pending },
    })
    if (!session) throw new NotFoundException("上传会话不存在。")
    await this.failUploadSession(userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.cancelled)
    return { ok: true }
  }

  async createFolder(userId: string, input: { parentId: string | null; name: string }): Promise<DriveItemDto> {
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
    return toDriveItemDto(folder)
  }

  async renameItem(userId: string, itemId: string, name: string): Promise<DriveItemDto> {
    const item = await this.requireOwnedItem(userId, itemId)
    const nextName = normalizeDriveName(name)
    if (item.type === DRIVE_ITEM_TYPE.folder) {
      const duplicate = await this.prisma.driveItem.findFirst({
        where: { userId, parentId: item.parentId, name: nextName, type: DRIVE_ITEM_TYPE.folder, deletedAt: null, id: { not: item.id } },
        select: { id: true },
      })
      if (duplicate) throw new BadRequestException("同名文件夹已存在。")
    }
    return toDriveItemDto(await this.prisma.driveItem.update({
      where: { id: itemId },
      data: { name: nextName },
      include: driveItemWithShares,
    }))
  }

  async moveItem(userId: string, itemId: string, parentId: string | null): Promise<DriveItemDto> {
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
    return toDriveItemDto(await this.prisma.driveItem.update({
      where: { id: item.id },
      data: { parentId },
      include: driveItemWithShares,
    }))
  }

  async deleteItem(userId: string, itemId: string, actorEmail = userId, ipAddress = "system"): Promise<{ readonly ok: true }> {
    await this.deleteItemInternal({ itemId, userId, actorEmail, ipAddress, admin: false })
    return { ok: true }
  }

  async createShare(userId: string, itemId: string, publicAppUrl: string): Promise<DriveShareDto> {
    const item = await this.requireOwnedItem(userId, itemId)
    const existing = await this.prisma.driveShare.findFirst({
      where: { itemId: item.id, userId, enabled: true },
    })
    const share = existing ?? await this.createUniqueShare(item.id, userId, item.type)
    return toDriveShareDto(share, publicAppUrl)
  }

  async disableShare(userId: string, shareId: string): Promise<{ readonly ok: true }> {
    const result = await this.prisma.driveShare.updateMany({
      where: { id: shareId, userId, enabled: true },
      data: { enabled: false, disabledAt: new Date() },
    })
    if (result.count === 0) throw new NotFoundException("分享不存在。")
    return { ok: true }
  }

  async getUsage(userId: string): Promise<DriveUsageDto> {
    const usage = await ensureUsage(this.prisma, userId)
    return {
      usedBytes: usage.usedBytes.toString(),
      reservedBytes: usage.reservedBytes.toString(),
      quotaBytes: usage.quotaBytes.toString(),
    }
  }

  async resolvePublicShare(shareId: string): Promise<{ readonly item: DriveItemDto; readonly ownerId: string; readonly storageKey: string | null; readonly type: "file" | "folder" }> {
    const share = await this.prisma.driveShare.findFirst({
      where: { shareId, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { item: { include: driveItemWithShares } },
    })
    if (!share || share.item.deletedAt || share.item.storageStatus !== DRIVE_STORAGE_STATUS.active) {
      throw new NotFoundException("文件未找到")
    }
    return {
      item: toDriveItemDto(share.item),
      ownerId: share.item.userId,
      storageKey: share.item.storageKey,
      type: share.item.type === DRIVE_ITEM_TYPE.folder ? "folder" : "file",
    }
  }

  async createDownloadUrlForShare(shareId: string): Promise<{ readonly url: string }> {
    const share = await this.resolvePublicShare(shareId)
    if (share.type !== "file" || !share.storageKey) throw new NotFoundException("文件未找到")
    const download = await this.storage.createDownloadUrl({ key: share.storageKey, filename: share.item.name })
    return { url: download.url }
  }

  async listPublicFolderChildren(shareId: string): Promise<{ readonly item: DriveItemDto; readonly children: DriveItemDto[] }> {
    const share = await this.resolvePublicShare(shareId)
    if (share.type !== "folder") throw new NotFoundException("文件未找到")
    const children = await this.prisma.driveItem.findMany({
      where: { userId: share.ownerId, parentId: share.item.id, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
      include: driveItemWithShares,
      orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    })
    return { item: share.item, children: children.map(toDriveItemDto) }
  }

  async createDownloadUrlForShareChild(shareId: string, itemId: string): Promise<{ readonly url: string }> {
    const share = await this.resolvePublicShare(shareId)
    if (share.type !== "folder") throw new NotFoundException("文件未找到")
    const child = await this.prisma.driveItem.findFirst({
      where: {
        id: itemId,
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

  async createFolderZipEntriesForShare(shareId: string): Promise<Array<{ readonly path: string; readonly url: string }>> {
    const share = await this.resolvePublicShare(shareId)
    if (share.type !== "folder") throw new NotFoundException("文件未找到")
    const entries: Array<{ readonly path: string; readonly url: string }> = []
    const queue: Array<{ readonly parentId: string; readonly prefix: string }> = [{ parentId: share.item.id, prefix: "" }]

    while (queue.length > 0) {
      const current = queue.shift()!
      const children = await this.prisma.driveItem.findMany({
        where: { userId: share.ownerId, parentId: current.parentId, deletedAt: null, storageStatus: DRIVE_STORAGE_STATUS.active },
        include: driveItemWithShares,
        orderBy: [{ type: "asc" }, { createdAt: "desc" }],
      })
      for (const child of children) {
        const childPath = current.prefix ? `${current.prefix}/${child.name}` : child.name
        if (child.type === DRIVE_ITEM_TYPE.folder) {
          queue.push({ parentId: child.id, prefix: childPath })
          continue
        }
        if (!child.storageKey) continue
        const download = await this.storage.createDownloadUrl({ key: child.storageKey, filename: child.name })
        entries.push({ path: childPath, url: download.url })
      }
    }

    return entries
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
      select: { id: true, userId: true, expectedSize: true, itemId: true },
    })
    for (const session of sessions) {
      await this.failUploadSession(session.userId, session.id, session.itemId, session.expectedSize, DRIVE_UPLOAD_STATUS.expired, now)
    }
    return { expired: sessions.length }
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
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.driveUploadSession.update({
        where: { id: sessionId },
        data: { status, failedAt: now },
      }),
      this.prisma.driveItem.update({
        where: { id: itemId },
        data: { storageStatus: DRIVE_STORAGE_STATUS.failed, uploadStatus: status },
      }),
      this.prisma.driveUsage.update({
        where: { userId },
        data: { reservedBytes: { decrement: expectedSize } },
      }),
    ])
  }

  private async createUniqueShare(itemId: string, userId: string, type: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.driveShare.create({
          data: { itemId, userId, type, shareId: createDriveShareId() },
        })
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error
      }
    }
    throw new Error("Unable to create unique drive share id.")
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
    await this.prisma.$transaction(async (tx) => {
      await tx.driveShare.updateMany({
        where: { itemId: { in: itemIds } },
        data: { enabled: false, disabledAt: deletedAt },
      })
      await tx.driveItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          deletedAt,
          storageStatus: DRIVE_STORAGE_STATUS.deleted,
          uploadStatus: DRIVE_UPLOAD_STATUS.completed,
        },
      })
      const usageDelta = activeFiles.reduce((sum, item) => sum + item.size, 0n)
      if (usageDelta > 0n) {
        await tx.driveUsage.update({
          where: { userId: root.userId },
          data: { usedBytes: { decrement: usageDelta } },
        })
      }
    })
    await this.auditLog?.record({
      adminEmail: input.actorEmail,
      action: input.admin ? "admin.drive.delete" : "drive.delete",
      targetType: "drive_item",
      targetId: root.id,
      detail: { count: itemIds.length },
      ipAddress: input.ipAddress,
    })
    for (const file of activeFiles) {
      await this.deleteStorageObject(file.id, file.storageKey!)
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
    } catch {
      await this.prisma.driveItem.update({
        where: { id: itemId },
        data: {
          storageDeletePending: true,
          storageStatus: DRIVE_STORAGE_STATUS.deletePending,
        },
      })
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

function toDriveShareDto(share: { id: string; shareId: string; itemId: string; enabled: boolean; createdAt: Date }, publicAppUrl: string): DriveShareDto {
  return {
    id: share.id,
    shareId: share.shareId,
    itemId: share.itemId,
    enabled: share.enabled,
    url: buildDriveShareUrl({ publicAppUrl, shareId: share.shareId }),
    createdAt: share.createdAt.toISOString(),
  }
}

function buildAdminWhere(filters: DriveAdminFilters): Prisma.DriveItemWhereInput {
  const where: Prisma.DriveItemWhereInput = { deletedAt: null }
  if (filters.userId) where.userId = filters.userId
  if (filters.type) where.type = filters.type
  if (filters.storageStatus) where.storageStatus = filters.storageStatus
  if (filters.shared === "true") where.shares = { some: { enabled: true } }
  if (filters.shared === "false") where.shares = { none: { enabled: true } }
  if (filters.search) {
    where.OR = [
      { id: { contains: filters.search, mode: "insensitive" } },
      { name: { contains: filters.search, mode: "insensitive" } },
    ]
  }
  return where
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
