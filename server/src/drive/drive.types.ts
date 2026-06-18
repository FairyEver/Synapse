import {
  type DriveFolderUploadPrepareFileInput,
  type DriveItemDto,
  type DriveItemLifecycleStatus,
  type DrivePublicAssetDto,
  type DriveStorageStatus,
  buildDrivePublicAssetUrl,
} from "@synapse/shared"

export type DrivePrepareUploadInput = {
  readonly parentId: string | null
  readonly name: string
  readonly size: string
  readonly mimeType?: string | null
  readonly publicAppUrl: string
}

export type DrivePublicAssetPrepareUploadInput = {
  readonly name: string
  readonly size: string
  readonly mimeType?: string | null
  readonly publicAppUrl?: string
}

export type DrivePublicAssetListInput = {
  readonly offset?: number
  readonly limit?: number
}

export type DrivePublicAssetRecord = {
  readonly assetId: string
  readonly itemId: string
  readonly name: string
  readonly size: bigint
  readonly mimeType: string
  readonly lifecycleStatus: string
  readonly accessCount: bigint
  readonly responseBytes: bigint
  readonly lastAccessedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export type DrivePrepareFolderUploadInput = {
  readonly parentId: string | null
  readonly folderName: string
  readonly files: readonly DriveFolderUploadPrepareFileInput[]
  readonly publicAppUrl: string
}

export type DriveAdminFilters = {
  readonly userId?: string
  readonly type?: string
  readonly storageStatus?: string
  readonly shared?: string
  readonly search?: string
}

export type DriveAdminItemDto = DriveItemDto & {
  readonly userId: string
  readonly userEmail?: string | null
  readonly storageDeletePending: boolean
  readonly lifecycleStatus: DriveItemLifecycleStatus
}

export type DriveAdminPublicAssetDto = DrivePublicAssetDto & {
  readonly owner: {
    readonly userId: string
    readonly email: string | null
  }
}

export type DriveAdminPublicAssetAccessLogDto = {
  readonly id: string
  readonly assetId: string
  readonly publicAssetId: string | null
  readonly userId: string | null
  readonly method: string
  readonly statusCode: number
  readonly bytes: string
  readonly ip: string | null
  readonly referer: string | null
  readonly userAgent: string | null
  readonly accessedAt: string
  readonly createdAt: string
}

export type DriveAdminPublicAssetRevisionDto = {
  readonly id: string
  readonly assetId: string
  readonly publicAssetId: string | null
  readonly itemId: string
  readonly name: string
  readonly originalName: string
  readonly size: string
  readonly mimeType: string | null
  readonly etag: string | null
  readonly replacedBy: string | null
  readonly createdAt: string
  readonly replacedAt: string
}

export type DriveAdminStorageSummaryDto = {
  readonly normalDrive: DriveAdminStorageBucketDto
  readonly publicAssets: DriveAdminStorageBucketDto
  readonly publicAssetRevisions: {
    readonly count: number
    readonly bytes: string
  }
  readonly total: {
    readonly quotaBytes: string
    readonly adminVisibleBytes: string
  }
}

export type DriveAdminStorageBucketDto = {
  readonly active: DriveAdminStorageStatusDto
  readonly trashed: DriveAdminStorageStatusDto
  readonly hidden: DriveAdminStorageStatusDto
}

export type DriveAdminStorageStatusDto = {
  readonly count: number
  readonly bytes: string
}

export type DriveItemRecord = {
  readonly id: string
  readonly parentId: string | null
  readonly type: string
  readonly name: string
  readonly size: bigint
  readonly mimeType: string | null
  readonly storageStatus: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly shares?: readonly { readonly id?: string; readonly enabled: boolean }[]
}

export function toDriveItemDto(item: DriveItemRecord): DriveItemDto {
  return {
    id: item.id,
    parentId: item.parentId,
    type: item.type === "folder" ? "folder" : "file",
    name: item.name,
    size: item.size.toString(),
    mimeType: item.mimeType,
    storageStatus: item.storageStatus as DriveStorageStatus,
    shared: item.shares?.some((share) => share.enabled) ?? false,
    activeShareId: item.shares?.find((share) => share.enabled)?.id ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}

export function toDrivePublicAssetDto(asset: DrivePublicAssetRecord, publicAppUrl: string): DrivePublicAssetDto {
  return {
    assetId: asset.assetId,
    itemId: asset.itemId,
    name: asset.name,
    size: asset.size.toString(),
    mimeType: asset.mimeType,
    url: buildDrivePublicAssetUrl({ publicAppUrl, assetId: asset.assetId }),
    lifecycleStatus: asset.lifecycleStatus as DriveItemLifecycleStatus,
    accessCount: asset.accessCount.toString(),
    responseBytes: asset.responseBytes.toString(),
    lastAccessedAt: asset.lastAccessedAt?.toISOString() ?? null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  }
}

export function toDriveAdminPublicAssetDto(
  asset: DrivePublicAssetRecord & { readonly userId: string; readonly user?: { readonly email?: string | null } | null },
  publicAppUrl: string,
): DriveAdminPublicAssetDto {
  return {
    ...toDrivePublicAssetDto(asset, publicAppUrl),
    owner: {
      userId: asset.userId,
      email: asset.user?.email ?? null,
    },
  }
}

export function toDriveAdminPublicAssetAccessLogDto(log: {
  readonly id: string
  readonly assetId: string
  readonly publicAssetId: string | null
  readonly userId: string | null
  readonly method: string
  readonly statusCode: number
  readonly bytes: bigint
  readonly ip: string | null
  readonly referer: string | null
  readonly userAgent: string | null
  readonly accessedAt: Date
}): DriveAdminPublicAssetAccessLogDto {
  const accessedAt = log.accessedAt.toISOString()
  return {
    id: log.id,
    assetId: log.assetId,
    publicAssetId: log.publicAssetId,
    userId: log.userId,
    method: log.method,
    statusCode: log.statusCode,
    bytes: log.bytes.toString(),
    ip: log.ip,
    referer: log.referer,
    userAgent: log.userAgent,
    accessedAt,
    createdAt: accessedAt,
  }
}

export function toDriveAdminPublicAssetRevisionDto(revision: {
  readonly id: string
  readonly assetId: string
  readonly publicAssetId: string | null
  readonly itemId: string
  readonly name: string
  readonly originalName: string
  readonly size: bigint
  readonly mimeType: string | null
  readonly etag: string | null
  readonly replacedBy: string | null
  readonly createdAt: Date
  readonly replacedAt: Date
}): DriveAdminPublicAssetRevisionDto {
  return {
    id: revision.id,
    assetId: revision.assetId,
    publicAssetId: revision.publicAssetId,
    itemId: revision.itemId,
    name: revision.name,
    originalName: revision.originalName,
    size: revision.size.toString(),
    mimeType: revision.mimeType,
    etag: revision.etag,
    replacedBy: revision.replacedBy,
    createdAt: revision.createdAt.toISOString(),
    replacedAt: revision.replacedAt.toISOString(),
  }
}
