import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import type { DriveItemDto, DriveTrashItemDto, DriveTrashListPageDto } from "@synapse/shared"
import { AuditLogService } from "../common/audit-log.service"
import { formatAuditError } from "../common/audit-error"
import { PrismaService } from "../prisma/prisma.service"
import { DriveChangeLogService } from "./drive-change-log"
import { DRIVE_ITEM_LIFECYCLE_STATUS, DRIVE_ITEM_TYPE, DRIVE_STORAGE_STATUS, DRIVE_UPLOAD_STATUS } from "./drive.constants"
import type { DriveStoragePort } from "./drive-storage"
import { isValidDriveItemName } from "./drive-token"
import { toDriveItemDto } from "./drive.types"

type DriveLifecycleInput = {
  readonly userId: string
  readonly itemId: string
  readonly actorId: string
  readonly ipAddress: string
  readonly allowPublicAsset?: boolean
}

type DriveTrashListInput = {
  readonly offset?: number
  readonly limit?: number
  readonly search?: string
}

type DriveLifecycleItemRecord = {
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
  readonly trashedAt: Date | null
  readonly trashedBy: string | null
  readonly hiddenAt: Date | null
  readonly hiddenBy: string | null
  readonly restoreParentId: string | null
  readonly restorePath: string | null
  readonly deleteRootId: string | null
  readonly deletedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly shares?: readonly { readonly id?: string; readonly enabled: boolean }[]
  readonly publicAsset?: { readonly assetId: string } | null
}

type DriveTrashRootQueryRecord = Omit<DriveLifecycleItemRecord, "publicAsset" | "shares"> & {
  readonly assetId: string | null
}

const DRIVE_TRASH_DEFAULT_LIMIT = 50
const DRIVE_TRASH_MAX_LIMIT = 200
const DRIVE_TRASH_TRANSACTION_MAX_WAIT_MS = 10_000
const DRIVE_TRASH_TRANSACTION_TIMEOUT_MS = 30_000

@Injectable()
export class DriveLifecycleService {
  private readonly logger = new Logger(DriveLifecycleService.name)
  private readonly uploadSessionCleanups = new Map<string, () => void>()

  constructor(
    private readonly prisma: PrismaService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly changes?: DriveChangeLogService,
  ) {}

  registerUploadSessionCleanup(sessionId: string, cleanup: () => void): void {
    this.uploadSessionCleanups.set(sessionId, cleanup)
  }

  forgetUploadSessionCleanup(sessionId: string): void {
    this.uploadSessionCleanups.delete(sessionId)
  }

  cleanupUploadSessionState(sessionId: string): void {
    const cleanup = this.uploadSessionCleanups.get(sessionId)
    if (!cleanup) return
    this.uploadSessionCleanups.delete(sessionId)
    try {
      cleanup()
    } catch (error) {
      this.logger.warn({
        sessionId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Drive upload session cleanup failed")
    }
  }

  async trashItem(input: DriveLifecycleInput): Promise<DriveItemDto> {
    void this.storage
    const root = await this.requireLifecycleItem(input.userId, input.itemId, DRIVE_ITEM_LIFECYCLE_STATUS.active, input.allowPublicAsset)
    const items = await this.collectSubtree(root.id, isActiveLifecycleItem)
    const itemIds = items.map((item) => item.id)
    const trashedAt = new Date()
    const restorePath = await this.buildRestorePath(root)

    await this.prisma.$transaction(async (tx) => {
      const updatedItems = await tx.driveItem.updateMany({
        where: { id: { in: itemIds }, lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active },
        data: {
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.trashed,
          trashedAt,
          trashedBy: input.actorId,
          hiddenAt: null,
          hiddenBy: null,
          restoreParentId: root.parentId,
          restorePath,
          deleteRootId: root.id,
        },
      })
      assertLifecycleTransitionCount(updatedItems.count, itemIds.length)
      await disableDriveSharesForItems(tx, itemIds, trashedAt)
      await updatePublicAssetLifecycle(tx, itemIds, {
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.trashed,
        trashedAt,
        trashedBy: input.actorId,
        hiddenAt: null,
        hiddenBy: null,
      }, DRIVE_ITEM_LIFECYCLE_STATUS.active)
      for (const item of items) {
        await this.changes?.append({
          userId: item.userId,
          itemId: item.id,
          parentId: item.parentId,
          type: "trashed",
          name: item.name,
          actor: input.actorId,
        }, tx)
      }
    }, {
      maxWait: DRIVE_TRASH_TRANSACTION_MAX_WAIT_MS,
      timeout: DRIVE_TRASH_TRANSACTION_TIMEOUT_MS,
    })
    await this.recordLifecycleAuditSafely({
      actorId: input.actorId,
      action: "drive.trash",
      targetId: root.id,
      ipAddress: input.ipAddress,
      detail: { userId: input.userId, itemId: root.id, count: itemIds.length },
    })
    return toDriveItemDto(await this.requireItemById(root.id))
  }

  async hideTrashedItem(input: DriveLifecycleInput): Promise<{ readonly ok: true }> {
    const root = await this.requireLifecycleItem(input.userId, input.itemId, DRIVE_ITEM_LIFECYCLE_STATUS.trashed, input.allowPublicAsset)
    if (root.deleteRootId !== root.id) throw new NotFoundException("文件不存在。")
    const items = await this.collectSubtree(root.id, belongsToDeletedTree(root.id, DRIVE_ITEM_LIFECYCLE_STATUS.trashed))
    const itemIds = items.map((item) => item.id)
    let releasedBytes = currentFileBytes(items)
    const hiddenAt = new Date()
    let cancelledUploadSessions = 0
    let releasedReservedBytes = 0n

    await this.prisma.$transaction(async (tx) => {
      releasedBytes += await publicAssetRevisionBytes(tx, itemIds)
      const pendingSessions = await tx.driveUploadSession.findMany({
        where: { userId: root.userId, itemId: { in: itemIds }, status: DRIVE_UPLOAD_STATUS.pending },
        select: { id: true, itemId: true, reservedBytes: true },
      })
      const pendingSessionIds = pendingSessions.map((session) => session.id)
      const pendingItemIds = pendingSessions.map((session) => session.itemId)
      const pendingReservedBytes = pendingSessions.reduce((sum, session) => sum + session.reservedBytes, 0n)

      const updatedItems = await tx.driveItem.updateMany({
        where: {
          id: { in: itemIds },
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.trashed,
          deleteRootId: root.id,
        },
        data: {
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.hidden,
          hiddenAt,
          hiddenBy: input.actorId,
        },
      })
      assertLifecycleTransitionCount(updatedItems.count, itemIds.length)
      await disableDriveSharesForItems(tx, itemIds, hiddenAt)
      await updatePublicAssetLifecycle(tx, itemIds, {
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.hidden,
        hiddenAt,
        hiddenBy: input.actorId,
      }, DRIVE_ITEM_LIFECYCLE_STATUS.trashed)
      if (pendingSessionIds.length > 0) {
        const updatedSessions = await tx.driveUploadSession.updateMany({
          where: { id: { in: pendingSessionIds }, userId: root.userId, status: DRIVE_UPLOAD_STATUS.pending },
          data: { status: DRIVE_UPLOAD_STATUS.cancelled, failedAt: hiddenAt },
        })
        assertLifecycleTransitionCount(updatedSessions.count, pendingSessionIds.length)
        await tx.driveItem.updateMany({
          where: { id: { in: pendingItemIds }, uploadStatus: DRIVE_UPLOAD_STATUS.pending },
          data: { uploadStatus: DRIVE_UPLOAD_STATUS.cancelled },
        })
      }
      if (releasedBytes > 0n) {
        await tx.driveUsage.update({
          where: { userId: root.userId },
          data: { usedBytes: { decrement: releasedBytes } },
        })
      }
      if (pendingReservedBytes > 0n) {
        await tx.driveUsage.update({
          where: { userId: root.userId },
          data: { reservedBytes: { decrement: pendingReservedBytes } },
        })
      }
      cancelledUploadSessions = pendingSessions.length
      releasedReservedBytes = pendingReservedBytes
    })
    await this.recordLifecycleAuditSafely({
      actorId: input.actorId,
      action: "drive.trash.hide",
      targetId: root.id,
      ipAddress: input.ipAddress,
      detail: {
        userId: input.userId,
        itemId: root.id,
        count: itemIds.length,
        releasedBytes: releasedBytes.toString(),
        releasedReservedBytes: releasedReservedBytes.toString(),
        cancelledUploadSessions,
      },
    })
    return { ok: true }
  }

  async restoreItem(input: DriveLifecycleInput): Promise<DriveItemDto> {
    return this.restoreItemForStatuses(input, [DRIVE_ITEM_LIFECYCLE_STATUS.trashed])
  }

  async restoreItemAsAdmin(input: DriveLifecycleInput): Promise<DriveItemDto> {
    return this.restoreItemForStatuses({ ...input, allowPublicAsset: true }, [
      DRIVE_ITEM_LIFECYCLE_STATUS.trashed,
      DRIVE_ITEM_LIFECYCLE_STATUS.hidden,
    ])
  }

  private async restoreItemForStatuses(input: DriveLifecycleInput, lifecycleStatuses: string[]): Promise<DriveItemDto> {
    const root = await this.prisma.driveItem.findFirst({
      where: {
        id: input.itemId,
        userId: input.userId,
        lifecycleStatus: { in: lifecycleStatuses },
        ...normalLifecycleItemWhere(input.allowPublicAsset),
      },
      include: { publicAsset: true, shares: { where: { enabled: true }, select: { id: true, enabled: true } } },
    }) as DriveLifecycleItemRecord | null
    if (!root) throw new NotFoundException("文件不存在。")
    if (root.deleteRootId !== root.id) throw new NotFoundException("文件不存在。")

    const restoringHidden = root.lifecycleStatus === DRIVE_ITEM_LIFECYCLE_STATUS.hidden
    const items = await this.collectSubtree(root.id, belongsToDeletedTree(root.id, root.lifecycleStatus))
    const itemIds = items.map((item) => item.id)
    let restoredBytes = restoringHidden ? currentFileBytes(items) : 0n
    if (restoringHidden) assertHiddenTreeCanRestore(items)

    const parentId = await this.resolveRestoreParent(root)
    const name = root.publicAsset ? root.name : await this.resolveRestoreName({
      userId: root.userId,
      parentId,
      type: root.type,
      name: root.name,
      excludeItemId: root.id,
    })
    const restoredAt = new Date()
    const restored = await this.prisma.$transaction(async (tx) => {
      if (restoringHidden) restoredBytes += await publicAssetRevisionBytes(tx, itemIds)
      if (restoredBytes > 0n) {
        const usage = await tx.driveUsage.findUniqueOrThrow({ where: { userId: input.userId } })
        if (usage.usedBytes + usage.reservedBytes + restoredBytes > usage.quotaBytes) {
          throw new BadRequestException("云盘空间不足。")
        }
        await tx.driveUsage.update({
          where: { userId: input.userId },
          data: { usedBytes: { increment: restoredBytes } },
        })
      }
      const updatedItems = await tx.driveItem.updateMany({
        where: {
          id: { in: itemIds },
          lifecycleStatus: root.lifecycleStatus,
          deleteRootId: root.id,
        },
        data: {
          lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
          trashedAt: null,
          trashedBy: null,
          hiddenAt: null,
          hiddenBy: null,
          restoreParentId: null,
          restorePath: null,
          deleteRootId: null,
          deletedAt: null,
        },
      })
      assertLifecycleTransitionCount(updatedItems.count, itemIds.length)
      await updatePublicAssetLifecycle(tx, itemIds, {
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
        trashedAt: null,
        trashedBy: null,
        hiddenAt: null,
        hiddenBy: null,
      }, root.lifecycleStatus)
      await enableDriveSharesForItems(tx, itemIds, root.trashedAt)
      const restoredRoot = await tx.driveItem.update({
        where: { id: root.id },
        data: { parentId, name, updatedAt: restoredAt },
        include: { shares: { where: { enabled: true }, select: { id: true, enabled: true } } },
      })
      for (const item of items) {
        await this.changes?.append({
          userId: item.userId,
          itemId: item.id,
          parentId: item.id === restoredRoot.id ? restoredRoot.parentId : item.parentId,
          type: "restored",
          name: item.id === restoredRoot.id ? restoredRoot.name : item.name,
          actor: input.actorId,
        }, tx)
      }
      return restoredRoot
    })
    await this.recordLifecycleAuditSafely({
      actorId: input.actorId,
      action: "drive.restore",
      targetId: root.id,
      ipAddress: input.ipAddress,
      detail: { userId: input.userId, itemId: root.id, count: itemIds.length, restoredBytes: restoredBytes.toString() },
    })
    return toDriveItemDto(restored)
  }

  async listTrash(userId: string, input: DriveTrashListInput = {}): Promise<DriveTrashListPageDto> {
    const page = normalizeTrashPage(input)
    const search = input.search?.trim()
    const searchPattern = search ? `%${escapeLikePattern(search)}%` : null
    const searchCondition = search
      ? Prisma.sql`AND (di."name" ILIKE ${searchPattern} ESCAPE '\\' OR di."restorePath" ILIKE ${searchPattern} ESCAPE '\\' OR pa."assetId" ILIKE ${searchPattern} ESCAPE '\\')`
      : Prisma.empty
    const [rootRows, totalRows] = await Promise.all([
      this.prisma.$queryRaw<DriveTrashRootQueryRecord[]>`
        SELECT di.*, pa."assetId"
        FROM "DriveItem" di
        LEFT JOIN "PublicAsset" pa ON pa."itemId" = di.id
        WHERE di."userId" = ${userId}
          AND di."lifecycleStatus" = ${DRIVE_ITEM_LIFECYCLE_STATUS.trashed}
          AND di."deleteRootId" = di.id
          ${searchCondition}
        ORDER BY di."trashedAt" DESC NULLS LAST, di."updatedAt" DESC
        LIMIT ${page.limit + 1}
        OFFSET ${page.offset}
      `,
      this.prisma.$queryRaw<Array<{ readonly total: bigint | number }>>`
        SELECT COUNT(*)::bigint AS total
        FROM "DriveItem" di
        LEFT JOIN "PublicAsset" pa ON pa."itemId" = di.id
        WHERE di."userId" = ${userId}
          AND di."lifecycleStatus" = ${DRIVE_ITEM_LIFECYCLE_STATUS.trashed}
          AND di."deleteRootId" = di.id
          ${searchCondition}
      `,
    ])
    const pageItems = rootRows.map(toTrashRootRecord)
    const total = Number(totalRows[0]?.total ?? 0)
    return {
      items: pageItems.slice(0, page.limit).map(toTrashItemDto),
      total,
      page: {
        offset: page.offset,
        limit: page.limit,
        hasMore: pageItems.length > page.limit,
        nextOffset: pageItems.length > page.limit ? page.offset + page.limit : null,
      },
    }
  }

  private async requireLifecycleItem(
    userId: string,
    itemId: string,
    lifecycleStatus: string,
    allowPublicAsset = false,
  ): Promise<DriveLifecycleItemRecord> {
    const item = await this.prisma.driveItem.findFirst({
      where: { id: itemId, userId, lifecycleStatus, ...normalLifecycleItemWhere(allowPublicAsset) },
      include: { publicAsset: true, shares: { where: { enabled: true }, select: { id: true, enabled: true } } },
    }) as DriveLifecycleItemRecord | null
    if (!item) throw new NotFoundException("文件不存在。")
    return item
  }

  private async requireItemById(itemId: string): Promise<DriveLifecycleItemRecord> {
    return this.prisma.driveItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { shares: { where: { enabled: true }, select: { id: true, enabled: true } } },
    }) as Promise<DriveLifecycleItemRecord>
  }

  private async collectSubtree(
    rootId: string,
    includeItem: (item: DriveLifecycleItemRecord) => boolean,
  ): Promise<DriveLifecycleItemRecord[]> {
    const result: DriveLifecycleItemRecord[] = []
    const queue = [rootId]
    while (queue.length > 0) {
      const ids = queue.splice(0, queue.length)
      const batch = await this.prisma.driveItem.findMany({
        where: { id: { in: ids } },
      }) as DriveLifecycleItemRecord[]
      const included = batch.filter(includeItem)
      result.push(...included)
      const parentIds = included.map((item) => item.id)
      if (parentIds.length === 0) continue
      const children = await this.prisma.driveItem.findMany({
        where: { parentId: { in: parentIds } },
        select: { id: true },
      })
      queue.push(...children.map((child) => child.id))
    }
    return result
  }

  private async buildRestorePath(item: DriveLifecycleItemRecord): Promise<string> {
    const names = [item.name]
    let parentId = item.parentId
    while (parentId) {
      const parent = await this.prisma.driveItem.findUnique({
        where: { id: parentId },
        select: { id: true, parentId: true, name: true },
      })
      if (!parent) break
      names.unshift(parent.name)
      parentId = parent.parentId
    }
    return names.join("/")
  }

  private async resolveRestoreParent(root: DriveLifecycleItemRecord): Promise<string | null> {
    if (!root.restoreParentId) return null
    const parent = await this.prisma.driveItem.findFirst({
      where: {
        id: root.restoreParentId,
        userId: root.userId,
        type: DRIVE_ITEM_TYPE.folder,
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
        deletedAt: null,
      },
      select: { id: true },
    })
    return parent?.id ?? null
  }

  private async resolveRestoreName(input: {
    readonly userId: string
    readonly parentId: string | null
    readonly type: string
    readonly name: string
    readonly excludeItemId: string
  }): Promise<string> {
    const usedNames = await this.activeSiblingNames(input)
    if (!usedNames.has(input.name)) return input.name
    const { baseName, extension } = splitFileName(input.name)
    for (let index = 1; index < 1000; index += 1) {
      const candidate = `${baseName} ${index}${extension}`
      if (!usedNames.has(candidate) && isValidDriveItemName(candidate)) return candidate
    }
    throw new BadRequestException("目标位置已有同名文件。")
  }

  private async activeSiblingNames(input: {
    readonly userId: string
    readonly parentId: string | null
    readonly type: string
    readonly excludeItemId: string
  }): Promise<Set<string>> {
    const siblings = await this.prisma.driveItem.findMany({
      where: {
        userId: input.userId,
        parentId: input.parentId,
        type: input.type,
        lifecycleStatus: DRIVE_ITEM_LIFECYCLE_STATUS.active,
        deletedAt: null,
        publicAsset: null,
        id: { not: input.excludeItemId },
      },
      select: { name: true },
    })
    return new Set(siblings.map((item) => item.name))
  }

  private async recordLifecycleAuditSafely(input: {
    readonly actorId: string
    readonly action: string
    readonly targetId: string
    readonly ipAddress: string
    readonly detail: unknown
  }): Promise<void> {
    try {
      await this.auditLog?.record({
        adminEmail: input.actorId,
        action: input.action,
        targetType: "drive_item",
        targetId: input.targetId,
        detail: input.detail,
        ipAddress: input.ipAddress,
      })
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: "drive_item",
        targetId: input.targetId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      }, "Failed to record drive lifecycle audit log")
    }
  }
}

function currentFileBytes(items: readonly DriveLifecycleItemRecord[]): bigint {
  return items
    .filter((item) => item.type === DRIVE_ITEM_TYPE.file && item.storageStatus === DRIVE_STORAGE_STATUS.active && item.storageKey)
    .reduce((sum, item) => sum + item.size, 0n)
}

async function publicAssetRevisionBytes(tx: unknown, itemIds: readonly string[]): Promise<bigint> {
  if (itemIds.length === 0) return 0n
  const revisions = (tx as {
    publicAssetRevision?: {
      aggregate?: (args: {
        readonly where: { readonly itemId: { readonly in: readonly string[] } }
        readonly _sum: { readonly size: true }
      }) => Promise<{ readonly _sum: { readonly size: bigint | null } }>
    }
  }).publicAssetRevision
  const aggregate = await revisions?.aggregate?.({
    where: { itemId: { in: itemIds } },
    _sum: { size: true },
  })
  return aggregate?._sum.size ?? 0n
}

function assertHiddenTreeCanRestore(items: readonly DriveLifecycleItemRecord[]): void {
  const invalidFile = items.find((item) =>
    item.type === DRIVE_ITEM_TYPE.file
    && (item.storageStatus !== DRIVE_STORAGE_STATUS.active
      || item.uploadStatus !== DRIVE_UPLOAD_STATUS.completed
      || !item.storageKey))
  if (invalidFile) throw new BadRequestException("上传未完成的文件无法恢复。")
}

function isActiveLifecycleItem(item: DriveLifecycleItemRecord): boolean {
  return item.lifecycleStatus === DRIVE_ITEM_LIFECYCLE_STATUS.active
}

function normalLifecycleItemWhere(allowPublicAsset = false) {
  return allowPublicAsset ? {} : { publicAsset: null }
}

function belongsToDeletedTree(rootId: string, lifecycleStatus: string): (item: DriveLifecycleItemRecord) => boolean {
  return (item) => item.lifecycleStatus === lifecycleStatus && item.deleteRootId === rootId
}

function assertLifecycleTransitionCount(actual: number, expected: number): void {
  if (actual !== expected) throw new NotFoundException("文件不存在。")
}

async function disableDriveSharesForItems(
  tx: Prisma.TransactionClient,
  itemIds: readonly string[],
  disabledAt: Date,
): Promise<void> {
  if (itemIds.length === 0) return
  await tx.driveShare.updateMany({
    where: { itemId: { in: [...itemIds] }, enabled: true },
    data: { enabled: false, disabledAt },
  })
}

async function enableDriveSharesForItems(
  tx: Prisma.TransactionClient,
  itemIds: readonly string[],
  disabledAt: Date | null,
): Promise<void> {
  if (itemIds.length === 0) return
  await tx.driveShare.updateMany({
    where: {
      itemId: { in: [...itemIds] },
      enabled: false,
      ...(disabledAt ? { disabledAt } : {}),
    },
    data: { enabled: true, disabledAt: null },
  })
}

function splitFileName(name: string): { readonly baseName: string; readonly extension: string } {
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex <= 0) return { baseName: name, extension: "" }
  return {
    baseName: name.slice(0, dotIndex),
    extension: name.slice(dotIndex),
  }
}

function normalizeTrashPage(input: DriveTrashListInput): { readonly offset: number; readonly limit: number } {
  const offset = typeof input.offset === "number" && Number.isFinite(input.offset) && input.offset > 0
    ? Math.floor(input.offset)
    : 0
  const requestedLimit = typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
    ? Math.floor(input.limit)
    : DRIVE_TRASH_DEFAULT_LIMIT
  return {
    offset,
    limit: Math.min(requestedLimit, DRIVE_TRASH_MAX_LIMIT),
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function toTrashItemDto(item: DriveLifecycleItemRecord): DriveTrashItemDto {
  return {
    id: item.id,
    kind: item.publicAsset ? "public_asset" : "normal",
    name: item.name,
    type: item.type === DRIVE_ITEM_TYPE.folder ? "folder" : "file",
    size: item.size.toString(),
    mimeType: item.mimeType,
    originalPath: item.restorePath,
    ...(item.publicAsset ? { assetId: item.publicAsset.assetId } : {}),
    trashedAt: (item.trashedAt ?? item.updatedAt).toISOString(),
  }
}

function toTrashRootRecord(row: DriveTrashRootQueryRecord): DriveLifecycleItemRecord {
  const { assetId, ...item } = row
  return {
    ...item,
    publicAsset: assetId ? { assetId } : null,
  }
}

async function updatePublicAssetLifecycle(
  tx: unknown,
  itemIds: readonly string[],
  data: Record<string, unknown>,
  lifecycleStatus: string,
): Promise<void> {
  const publicAsset = (tx as { publicAsset?: { updateMany?: (args: unknown) => Promise<unknown> } }).publicAsset
  await publicAsset?.updateMany?.({
    where: { itemId: { in: itemIds }, lifecycleStatus },
    data,
  })
}
