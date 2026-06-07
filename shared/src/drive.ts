export const DRIVE_PUBLIC_PATH_PREFIX = "/files"

export type DriveItemType = "file" | "folder"
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

function normalizePublicAppUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "")
}
