import { DRIVE_DEFAULT_QUOTA_BYTES, DRIVE_MAX_FILE_BYTES } from "@synapse/shared"

export const driveDefaultQuotaBytes = BigInt(DRIVE_DEFAULT_QUOTA_BYTES)
export const driveMaxFileBytes = BigInt(DRIVE_MAX_FILE_BYTES)
export const drivePublicAssetMaxFileBytes = driveMaxFileBytes
export const driveUploadUrlTtlSeconds = 15 * 60
export const driveDownloadUrlTtlSeconds = 5 * 60

export const DRIVE_ITEM_TYPE = {
  file: "file",
  folder: "folder",
} as const

export const DRIVE_ITEM_LIFECYCLE_STATUS = {
  active: "active",
  trashed: "trashed",
  hidden: "hidden",
  legacyMissing: "legacy_missing",
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

export const DRIVE_UPLOAD_PURPOSE = {
  driveUpload: "drive_upload",
  publicAssetUpload: "public_asset_upload",
  publicAssetReplace: "public_asset_replace",
} as const

export const DRIVE_SITE_STATUS = {
  active: "active",
  disabled: "disabled",
  failed: "failed",
  deleted: "deleted",
} as const

export const DRIVE_SITE_DEPLOYMENT_STATUS = {
  pending: "pending",
  active: "active",
  failed: "failed",
} as const

export const DRIVE_SITE_ACCESS_MODE = {
  public: "public",
  password: "password",
} as const
