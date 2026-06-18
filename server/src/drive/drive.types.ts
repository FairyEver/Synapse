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
