import {
  buildDrivePublicationUrl,
  type DriveFolderUploadPrepareFileInput,
  type DriveItemDto,
  type DrivePublicationDto,
  type DriveStorageStatus,
} from "@synapse/shared"

export type DrivePrepareUploadInput = {
  readonly parentId: string | null
  readonly name: string
  readonly size: string
  readonly mimeType?: string | null
  readonly publicAppUrl: string
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

export type DrivePublicationRecord = {
  readonly id: string
  readonly publishId: string
  readonly type: string
  readonly name: string
  readonly status: string
  readonly sourceItemId: string | null
  readonly currentDeploymentId: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly sourceItem?: { readonly deletedAt: Date | null } | null
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

export function toDrivePublicationDto(item: DrivePublicationRecord, publicAppUrl: string): DrivePublicationDto {
  const type = item.type === "site" ? "site" : "page"
  return {
    id: item.id,
    publishId: item.publishId,
    type,
    name: item.name,
    status: item.status === "disabled" ? "disabled" : "active",
    sourceItemId: item.sourceItemId,
    sourceDeleted: item.sourceItem?.deletedAt !== null && item.sourceItem?.deletedAt !== undefined,
    url: buildDrivePublicationUrl({ publicAppUrl, publishId: item.publishId, type }),
    currentDeploymentId: item.currentDeploymentId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}
