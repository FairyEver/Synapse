import {
  buildDrivePublicationUrl,
  buildDriveUrlWithPassword,
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
  readonly passwordEnabled?: boolean
  readonly passwordHash?: string | null
  readonly passwordEncrypted?: string | null
  readonly expiresAt?: Date | null
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

export function toDrivePublicationDto(item: DrivePublicationRecord, publicAppUrl: string, password: string | null = null): DrivePublicationDto {
  const type = item.type === "site" ? "site" : "page"
  const url = buildDrivePublicationUrl({ publicAppUrl, publishId: item.publishId, type })
  const passwordEnabled = item.passwordEnabled ?? false
  return {
    id: item.id,
    publishId: item.publishId,
    type,
    name: item.name,
    status: item.status === "active" && item.currentDeploymentId ? "active" : "disabled",
    sourceItemId: item.sourceItemId,
    sourceDeleted: item.sourceItem?.deletedAt !== null && item.sourceItem?.deletedAt !== undefined,
    url,
    urlWithPassword: buildDriveUrlWithPassword(url, passwordEnabled ? password : null),
    passwordEnabled,
    password: passwordEnabled ? password : null,
    expiresAt: item.expiresAt?.toISOString() ?? null,
    currentDeploymentId: item.currentDeploymentId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}
