import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { DriveFileVersionDto, DriveFileVersionSource } from "@synapse/shared"

type VersionTx = Prisma.TransactionClient

export const DRIVE_FILE_VERSION_SOURCE = {
  upload: "upload",
  onlineEdit: "online_edit",
  restore: "restore",
} as const satisfies Record<string, DriveFileVersionSource>

export function createDriveFileVersionId(): string {
  return `dfv_${randomUUID().replace(/-/gu, "")}`
}

export function driveVersionStorageKey(itemId: string, versionId: string): string {
  return `drive/${itemId}/versions/${versionId}`
}

export async function ensureCurrentDriveFileVersion(tx: VersionTx, input: {
  readonly item: {
    readonly id: string
    readonly userId: string
    readonly storageKey: string | null
    readonly size: bigint
    readonly mimeType: string | null
    readonly updatedAt: Date
  }
}): Promise<void> {
  if (!input.item.storageKey) return
  const existing = await tx.driveFileVersion.findFirst({
    where: { itemId: input.item.id, storageKey: input.item.storageKey, deletedAt: null },
    select: { id: true },
  })
  if (existing) return
  await tx.driveFileVersion.create({
    data: {
      itemId: input.item.id,
      userId: input.item.userId,
      versionNumber: await nextDriveFileVersionNumber(tx, input.item.id),
      storageKey: input.item.storageKey,
      size: input.item.size,
      mimeType: input.item.mimeType,
      source: DRIVE_FILE_VERSION_SOURCE.upload,
      createdAt: input.item.updatedAt,
    },
  })
}

export async function createDriveFileVersion(tx: VersionTx, input: {
  readonly id: string
  readonly itemId: string
  readonly userId: string
  readonly storageKey: string
  readonly size: bigint
  readonly mimeType: string | null
  readonly source: DriveFileVersionSource
  readonly etag?: string | null
  readonly restoredFromVersionId?: string | null
  readonly createdBy?: string | null
}): Promise<{ readonly id: string; readonly storageKey: string; readonly versionNumber: number }> {
  const version = await tx.driveFileVersion.create({
    data: {
      id: input.id,
      itemId: input.itemId,
      userId: input.userId,
      versionNumber: await nextDriveFileVersionNumber(tx, input.itemId),
      storageKey: input.storageKey,
      size: input.size,
      mimeType: input.mimeType,
      etag: input.etag ?? null,
      source: input.source,
      createdBy: input.createdBy ?? null,
      restoredFromVersionId: input.restoredFromVersionId ?? null,
    },
  })
  return { id: version.id, storageKey: version.storageKey, versionNumber: version.versionNumber }
}

export function toDriveFileVersionDto(version: {
  readonly id: string
  readonly itemId: string
  readonly versionNumber: number
  readonly size: bigint
  readonly mimeType: string | null
  readonly source: string
  readonly isPinned: boolean
  readonly deletePending: boolean
  readonly restoredFromVersionId: string | null
  readonly createdAt: Date
  readonly createdBy: string | null
  readonly storageKey: string
}, currentStorageKey: string | null): DriveFileVersionDto {
  return {
    id: version.id,
    itemId: version.itemId,
    versionNumber: version.versionNumber,
    size: version.size.toString(),
    mimeType: version.mimeType,
    source: normalizeDriveFileVersionSource(version.source),
    isCurrent: currentStorageKey === version.storageKey,
    isPinned: version.isPinned,
    deletePending: version.deletePending,
    restoredFromVersionId: version.restoredFromVersionId,
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
  }
}

function normalizeDriveFileVersionSource(value: string): DriveFileVersionSource {
  if (value === DRIVE_FILE_VERSION_SOURCE.restore) return DRIVE_FILE_VERSION_SOURCE.restore
  if (value === DRIVE_FILE_VERSION_SOURCE.onlineEdit) return DRIVE_FILE_VERSION_SOURCE.onlineEdit
  return DRIVE_FILE_VERSION_SOURCE.upload
}

async function nextDriveFileVersionNumber(tx: VersionTx, itemId: string): Promise<number> {
  const latest = await tx.driveFileVersion.findFirst({
    where: { itemId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  })
  return (latest?.versionNumber ?? 0) + 1
}
