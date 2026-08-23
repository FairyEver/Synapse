export const DRIVE_OPEN_API_ARCHIVE_MAX_FILES = 1_000
export const DRIVE_OPEN_API_ARCHIVE_MAX_BYTES = 200n * 1024n * 1024n

export type DriveOpenApiDownloadSourceType =
  | "share"
  | "share_item"
  | "site"
  | "site_path"
  | "public_asset"

export type DriveOpenApiDownloadTarget =
  | {
    readonly kind: "share"
    readonly shareId: string
    readonly itemId: string
  }
  | {
    readonly kind: "site"
    readonly siteId: string
    readonly deploymentId: string
  }
  | {
    readonly kind: "public_asset"
    readonly assetId: string
    readonly publicAssetId: string
  }

export type DriveOpenApiDownloadEntry = {
  readonly entryType: "file" | "directory"
  readonly relativePath: string | null
  readonly storageKey: string | null
  readonly driveFileVersionId: string | null
  readonly immutableId: string | null
  readonly size: bigint | null
  readonly mimeType: string | null
  readonly etag: string | null
  readonly sha256: string | null
}

export type DriveOpenApiDownloadArtifact = {
  readonly sourceType: DriveOpenApiDownloadSourceType
  readonly artifactType: "file" | "archive"
  readonly fileName: string
  readonly mimeType: string
  readonly size: bigint | null
  readonly entryPath: string | null
  readonly target: DriveOpenApiDownloadTarget
  readonly entries: readonly DriveOpenApiDownloadEntry[]
}

export type DriveOpenApiDownloadPreparationResult =
  | { readonly status: "ok"; readonly artifact: DriveOpenApiDownloadArtifact }
  | { readonly status: "password_required" | "not_found" | "archive_too_large" }

export class DriveOpenApiDownloadPreparationError extends Error {
  constructor(readonly reason: "unsupported_link" | "password_required" | "not_found" | "archive_too_large") {
    super(reason)
    this.name = "DriveOpenApiDownloadPreparationError"
  }
}
