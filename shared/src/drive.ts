export const DRIVE_PUBLIC_PATH_PREFIX = "/files"
export const DRIVE_PAGE_PUBLIC_PATH_PREFIX = "/pages"
export const DRIVE_SITE_PUBLIC_PATH_PREFIX = "/sites"

export type DriveItemType = "file" | "folder"
export type DrivePublicationType = "page" | "site"
export type DrivePublicationStatus = "active" | "disabled"
export type DriveShareItemType = "file" | "folder"
export type DriveStorageStatus = "pending" | "active" | "delete_pending" | "deleted" | "failed"
export type DriveUploadSessionStatus = "pending" | "completed" | "cancelled" | "expired" | "failed"

export interface DriveItemDto {
  readonly id: string
  readonly parentId: string | null
  readonly type: DriveItemType
  readonly name: string
  readonly size: string
  readonly mimeType: string | null
  readonly storageStatus: DriveStorageStatus
  readonly shared: boolean
  readonly activeShareId?: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DriveUploadPrepareResult {
  readonly sessionId: string
  readonly item: DriveItemDto
  readonly upload: {
    readonly method: "PUT"
    readonly url: string
    readonly expiresAt: string
    readonly headers: Record<string, string>
  }
}

export interface DriveFolderUploadPrepareFileInput {
  readonly relativePath: string
  readonly size: string
  readonly mimeType?: string | null
}

export interface DriveFolderUploadPrepareResult {
  readonly root: DriveItemDto
  readonly entries: Array<{
    readonly relativePath: string
    readonly sessionId: string
    readonly item: DriveItemDto
    readonly upload: DriveUploadPrepareResult["upload"]
  }>
}

export interface DriveShareDto {
  readonly id: string
  readonly shareId: string
  readonly itemId: string
  readonly enabled: boolean
  readonly url: string
  readonly createdAt: string
}

export interface DrivePublicationDto {
  readonly id: string
  readonly publishId: string
  readonly type: DrivePublicationType
  readonly name: string
  readonly status: DrivePublicationStatus
  readonly sourceItemId: string | null
  readonly sourceDeleted: boolean
  readonly url: string
  readonly currentDeploymentId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DriveDeleteImpactDto {
  readonly publications: DrivePublicationDto[]
}

export interface DriveShareListItemDto {
  readonly id: string
  readonly shareId: string
  readonly itemId: string
  readonly itemName: string
  readonly itemType: DriveShareItemType
  readonly sourceDeleted: boolean
  readonly url: string
  readonly createdAt: string
}

export interface DriveUsageDto {
  readonly usedBytes: string
  readonly reservedBytes: string
  readonly quotaBytes: string
}

export function buildDriveShareUrl(input: {
  readonly publicAppUrl: string
  readonly shareId: string
}): string {
  return `${normalizePublicAppUrl(input.publicAppUrl)}${DRIVE_PUBLIC_PATH_PREFIX}/${encodeURIComponent(input.shareId)}`
}

export function buildDrivePublicationUrl(input: {
  readonly publicAppUrl: string
  readonly publishId: string
  readonly type: DrivePublicationType
}): string {
  const base = normalizePublicAppUrl(input.publicAppUrl)
  const encoded = encodeURIComponent(input.publishId)
  return input.type === "site"
    ? `${base}${DRIVE_SITE_PUBLIC_PATH_PREFIX}/${encoded}/`
    : `${base}${DRIVE_PAGE_PUBLIC_PATH_PREFIX}/${encoded}`
}

export function maskDriveShareUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const parts = parsed.pathname.split("/")
    if (parts.length >= 3 && parts[1] === "files") {
      parts[2] = "***"
      parsed.pathname = parts.join("/")
      return parsed.toString()
    }
  } catch {
    return value.replace(/\/files\/[^/?#]+/u, "/files/***")
  }
  return value.replace(/\/files\/[^/?#]+/u, "/files/***")
}

export function maskDrivePublicUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const parts = parsed.pathname.split("/")
    if (parts.length >= 3 && (parts[1] === "pages" || parts[1] === "sites")) {
      parts[2] = "***"
      parsed.pathname = parts.join("/")
      return parsed.toString()
    }
  } catch {
    return value
      .replace(/\/pages\/[^/?#]+/u, "/pages/***")
      .replace(/\/sites\/[^/?#]+/u, "/sites/***")
  }
  return value
    .replace(/\/pages\/[^/?#]+/u, "/pages/***")
    .replace(/\/sites\/[^/?#]+/u, "/sites/***")
}

function normalizePublicAppUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "")
}
