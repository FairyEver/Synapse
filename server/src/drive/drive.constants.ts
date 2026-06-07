export const driveDefaultQuotaBytes = 10n * 1024n * 1024n * 1024n
export const driveMaxFileBytes = 1n * 1024n * 1024n * 1024n
export const driveUploadUrlTtlSeconds = 15 * 60
export const driveDownloadUrlTtlSeconds = 5 * 60

export const DRIVE_ITEM_TYPE = {
  file: "file",
  folder: "folder",
} as const

export const DRIVE_STORAGE_STATUS = {
  pending: "pending",
  active: "active",
  deletePending: "delete_pending",
  deleted: "deleted",
  failed: "failed",
} as const

export const DRIVE_UPLOAD_STATUS = {
  pending: "pending",
  completed: "completed",
  cancelled: "cancelled",
  expired: "expired",
  failed: "failed",
} as const
