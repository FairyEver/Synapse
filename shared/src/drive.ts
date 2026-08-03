export const DRIVE_PUBLIC_PATH_PREFIX = "/share"
export const DRIVE_PUBLIC_ASSET_PATH_PREFIX = "/files"
export const DRIVE_SITE_PATH_PREFIX = "/sites"
export const DRIVE_OWNER_BROWSER_PATH_PREFIX = "/drive/items"
export const DRIVE_CONSOLE_BROWSER_PATH_PREFIX = "/console/drive"
export const DRIVE_SHARE_BROWSER_PATH_PREFIX = DRIVE_PUBLIC_PATH_PREFIX
export const DRIVE_MAX_FILE_BYTES = 100 * 1024 * 1024
export const DRIVE_DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024
export const DRIVE_SITE_DEFAULT_PAGE_SIZE = 50
export const DRIVE_SITE_MAX_PAGE_SIZE = 200
export const DRIVE_SITE_MAX_FILES = 1000
export const DRIVE_SITE_MAX_TOTAL_BYTES = 200 * 1024 * 1024
export const DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES = 20
export const DRIVE_MAX_FILE_SIZE_LABEL = "100MB"
export const DRIVE_DEFAULT_QUOTA_LABEL = "5GB"
export const DRIVE_SITE_MAX_TOTAL_SIZE_LABEL = "200MB"
export const DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  ico: "image/x-icon",
} as const
export const DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
} as const
export const DRIVE_PUBLIC_ASSET_MIME_BY_EXTENSION = {
  ...DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION,
  ...DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION,
} as const
export const DRIVE_PUBLIC_ASSET_IMAGE_UNSUPPORTED_FORMAT_MESSAGE = "仅支持 PNG、JPG、JPEG、GIF、WebP、AVIF、ICO 图片；不支持 SVG。"
export const DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE = "仅支持 PNG、JPG、JPEG、GIF、WebP、AVIF、ICO、PDF、DOCX、XLSX、PPTX、TXT、MD、CSV 文件；不支持 SVG。"

export type DriveItemType = "file" | "folder"
export type DriveShareItemType = "file" | "folder"
export type DriveStorageStatus = "pending" | "active" | "delete_pending" | "deleted" | "failed"
export type DriveUploadSessionStatus = "pending" | "completed" | "cancelled" | "expired" | "failed"
export type DriveAccessExpiresIn = "3d" | "7d" | "30d" | "1y" | "forever"
export type DriveShareAccessMode = "link_read" | "link_edit" | "specified_users_edit"
export type DriveBrowserAccessContext = "owner" | "share"
export type DriveBrowserSurface = "standalone" | "console"
export type DriveBrowserPreviewKind = "image" | "text" | "html-source" | "markdown" | "download-only"
export type DriveBrowserEditKind = "text" | "replace" | "none"
export type DriveBrowserEditUnavailableReason = "unsupported" | "truncated" | "login_required" | "permission_denied" | "quota"
export type DriveBrowserAnnotationUnavailableReason = "login_required" | "permission_denied"
export type DriveFileVersionSource = "upload" | "online_edit" | "restore"
export type DriveItemLifecycleStatus = "active" | "trashed" | "hidden" | "legacy_missing"
export type DriveTrashItemKind = "normal" | "public_asset"
export type DrivePublicAssetContentKind = "image" | "document"
export type DriveSiteStatus = "active" | "disabled" | "expired" | "deleted" | "failed"
export type DriveSiteAccessMode = "public" | "password"
export const DRIVE_CHANGE_TYPES = [
  "created",
  "content_updated",
  "renamed",
  "moved",
  "trashed",
  "restored",
  "deleted",
] as const
export type DriveChangeType = typeof DRIVE_CHANGE_TYPES[number]
export const DRIVE_SYNC_BINDING_STATUSES = [
  "initializing",
  "active",
  "paused",
  "conflict",
  "error",
  "removed",
] as const
export type DriveSyncBindingStatus = typeof DRIVE_SYNC_BINDING_STATUSES[number]
export const DRIVE_SYNC_OPERATION_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "retry_wait",
  "conflict",
  "error",
] as const
export type DriveSyncOperationStatus = typeof DRIVE_SYNC_OPERATION_STATUSES[number]
export const DRIVE_SYNC_OPERATION_KINDS = [
  "download",
  "upload",
  "delete_local",
  "delete_remote",
  "move_local",
  "move_remote",
  "scan",
  "resync",
] as const
export type DriveSyncOperationKind = typeof DRIVE_SYNC_OPERATION_KINDS[number]
export const DRIVE_SYNC_INITIAL_DIRECTIONS = ["remote_to_local", "local_to_remote", "bind_existing"] as const
export type DriveSyncInitialDirection = typeof DRIVE_SYNC_INITIAL_DIRECTIONS[number]
export const DRIVE_SYNC_BINDING_PREVIEW_STATUSES = ["ready", "blocked", "warning"] as const
export type DriveSyncBindingPreviewStatus = typeof DRIVE_SYNC_BINDING_PREVIEW_STATUSES[number]
export const DRIVE_SYNC_CONFLICT_RESOLUTIONS = ["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"] as const
export type DriveSyncConflictResolutionAction = typeof DRIVE_SYNC_CONFLICT_RESOLUTIONS[number]
export const DRIVE_SYNC_HEALTH_STATUSES = ["idle", "syncing", "retrying", "paused", "error"] as const
export type DriveSyncHealth = typeof DRIVE_SYNC_HEALTH_STATUSES[number]
export type DriveDocumentImageSourceKind =
  | "owner_asset"
  | "collaborator_asset"
  | "external"
  | "relative"
  | "data"
  | "invalid"
  | "unsupported"
export type DriveDocumentImageSourceStatus =
  | "ready"
  | "checking"
  | "unreachable"
  | "importing"
  | "imported"
  | "failed"
export type DriveDocumentImageImportDisabledReason =
  | "not_owner"
  | "already_owned"
  | "unreachable"
  | "unsupported"
  | "quota"
  | "too_large"

export function isDriveMarkdownItem(item: {
  readonly type: DriveItemType | string
  readonly name: string
  readonly mimeType: string | null
}): boolean {
  if (item.type !== "file") return false
  const lowerName = item.name.toLowerCase()
  const mimeType = item.mimeType?.toLowerCase() ?? ""
  return lowerName.endsWith(".md")
    || lowerName.endsWith(".markdown")
    || lowerName.endsWith(".mdx")
    || mimeType === "text/markdown"
    || mimeType === "text/x-markdown"
}

export interface DriveAccessSettingsInput {
  readonly passwordEnabled: boolean
  readonly expiresIn: DriveAccessExpiresIn
  readonly accessMode?: DriveShareAccessMode
  readonly editorEmails?: readonly string[]
}

export type DriveAccessSettingsUpdateInput = Partial<DriveAccessSettingsInput>

export const DRIVE_DEFAULT_ACCESS_SETTINGS: DriveAccessSettingsInput = {
  passwordEnabled: true,
  expiresIn: "3d",
  accessMode: "link_read",
  editorEmails: [],
}

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
  readonly activeShare?: DriveItemActiveShareDto | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DriveItemListInput {
  readonly parentId?: string | null
  readonly offset?: number
  readonly limit?: number
}

export interface DriveItemListPageDto {
  readonly items: readonly DriveItemDto[]
  readonly page: DriveBrowserChildrenPageDto
}

export interface DriveChangeDto {
  readonly id: string
  readonly sequence: string
  readonly itemId: string
  readonly parentId: string | null
  readonly type: DriveChangeType
  readonly versionId?: string | null
  readonly etag?: string | null
  readonly name?: string | null
  readonly pathHint?: string | null
  readonly currentPathHint?: string | null
  readonly itemKind?: DriveItemType | null
  readonly actor?: string | null
  readonly occurredAt: string
}

export interface DriveChangeListInput {
  readonly cursor?: string | null
  readonly limit?: number
  readonly rootItemId?: string | null
  readonly rootPathHint?: string | null
}

export interface DriveChangeListPageDto {
  readonly items: readonly DriveChangeDto[]
  readonly nextCursor: string | null
  readonly hasMore: boolean
  readonly resyncRequired: boolean
}

export interface DriveSyncBindingDto {
  readonly id: string
  readonly driveItemId: string
  readonly driveItemName: string
  readonly drivePathHint: string | null
  readonly kind: DriveItemType
  readonly localPath: string
  readonly status: DriveSyncBindingStatus
  readonly remoteCursor: string | null
  readonly excludeRules: DriveSyncExcludeRulesDto
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastSyncedAt: string | null
  readonly lastError: string | null
}

export interface DriveSyncConflictDto {
  readonly id: string
  readonly bindingId: string
  readonly relativePath: string
  readonly type: string
  readonly localSummary: string | null
  readonly remoteSummary: string | null
  readonly availableActions: readonly DriveSyncConflictResolutionAction[]
  readonly createdAt: string
}

export interface DriveSyncOperationDto {
  readonly id: string
  readonly bindingId: string
  readonly kind: DriveSyncOperationKind
  readonly relativePath: string
  readonly status: DriveSyncOperationStatus
  readonly message: string | null
  readonly attemptCount: number
  readonly nextRetryAt: string | null
  readonly completedBytes: number | null
  readonly totalBytes: number | null
  readonly updatedAt: string
}

export interface DriveSyncSnapshotDto {
  readonly bindings: readonly DriveSyncBindingDto[]
  readonly conflicts: readonly DriveSyncConflictDto[]
  readonly operations: readonly DriveSyncOperationDto[]
  readonly health: {
    readonly status: DriveSyncHealth
    readonly connectivity: "online" | "offline"
    readonly readOnly: boolean
    readonly lastError: string | null
    readonly updatedAt: string
  }
  readonly summary: {
    readonly activeBindingCount: number
    readonly runningOperationCount: number
    readonly retryWaitingOperationCount: number
    readonly conflictCount: number
    readonly errorCount: number
  }
}

export interface DriveSyncBindingPreviewDto {
  readonly status: DriveSyncBindingPreviewStatus
  readonly direction: DriveSyncInitialDirection | null
  readonly reason: string | null
  readonly localPath: string
  readonly localKind: "missing" | "file" | "folder" | "other"
  readonly localEmpty: boolean | null
  readonly forcedExcludeRules: readonly string[]
  readonly defaultExcludeRules: readonly string[]
  readonly importedGitignoreRules: readonly string[]
  readonly detectedGitignoreRules: readonly string[]
}

export interface DriveSyncCreateSafeBindingInput {
  readonly driveItemId: string
  readonly driveItemName: string
  readonly kind: DriveItemType
  readonly drivePathHint?: string | null
  readonly targetParentId?: string | null
  readonly localPath: string
  readonly direction: DriveSyncInitialDirection
  readonly excludeRules?: readonly string[]
  readonly useDefaultExcludes?: boolean
  readonly importGitignore?: boolean
}

export interface DriveSyncUpdateExcludeRulesInput {
  readonly id: string
  readonly defaults: readonly string[]
  readonly importedGitignore: readonly string[]
  readonly user: readonly string[]
}

export interface DriveSyncExcludeRulesDto {
  readonly forced: readonly string[]
  readonly defaults: readonly string[]
  readonly importedGitignore: readonly string[]
  readonly user: readonly string[]
}

export interface DriveSyncConflictResolutionInput {
  readonly conflictId: string
  readonly action: DriveSyncConflictResolutionAction
}

export interface DriveItemActiveShareDto {
  readonly id: string
  readonly passwordEnabled: boolean
  readonly expiresAt: string | null
  readonly accessMode: DriveShareAccessMode
  readonly editorCount: number
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

export interface DriveFolderUploadPrepareDirectoryInput {
  readonly relativePath: string
}

export interface DriveFolderUploadPrepareResult {
  readonly root: DriveItemDto
  readonly rootCreated: boolean
  readonly entries: Array<{
    readonly relativePath: string
    readonly sessionId: string
    readonly item: DriveItemDto
    readonly upload: DriveUploadPrepareResult["upload"]
  }>
}

export interface DriveFileVersionDto {
  readonly id: string
  readonly itemId: string
  readonly versionNumber: number
  readonly size: string
  readonly mimeType: string | null
  readonly source: DriveFileVersionSource
  readonly isCurrent: boolean
  readonly isPinned: boolean
  readonly deletePending: boolean
  readonly restoredFromVersionId: string | null
  readonly createdAt: string
  readonly createdBy: string | null
}

export interface DriveFileVersionListInput {
  readonly offset?: number
  readonly limit?: number
}

export interface DriveFileVersionListPageDto {
  readonly items: readonly DriveFileVersionDto[]
  readonly total: number
  readonly page: DriveBrowserChildrenPageDto
}

export interface DrivePublicAssetDto {
  readonly assetId: string
  readonly itemId: string
  readonly name: string
  readonly size: string
  readonly mimeType: string
  readonly url: string
  readonly lifecycleStatus: DriveItemLifecycleStatus
  readonly accessCount: string
  readonly responseBytes: string
  readonly lastAccessedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DrivePublicAssetListPageDto {
  readonly items: readonly DrivePublicAssetDto[]
  readonly total: number
  readonly page: DriveBrowserChildrenPageDto
}

export interface DriveTrashItemDto {
  readonly id: string
  readonly kind: DriveTrashItemKind
  readonly name: string
  readonly type: DriveItemType
  readonly size: string
  readonly mimeType: string | null
  readonly originalPath: string | null
  readonly assetId?: string
  readonly trashedAt: string
}

export interface DriveTrashListPageDto {
  readonly items: readonly DriveTrashItemDto[]
  readonly total: number
  readonly page: DriveBrowserChildrenPageDto
}

export interface DriveSiteCreateInput {
  readonly sourceFolderItemId: string
  readonly name: string
  readonly entryPath?: string | null
  readonly accessMode: DriveSiteAccessMode
  readonly password?: string | null
  readonly expiresIn: DriveAccessExpiresIn
}

export interface DriveSiteAccessUpdateInput {
  readonly accessMode: DriveSiteAccessMode
  readonly password?: string | null
  readonly expiresIn: DriveAccessExpiresIn
}

export interface DriveSiteDto {
  readonly id: string
  readonly siteId: string
  readonly name: string
  readonly status: DriveSiteStatus
  readonly accessMode: DriveSiteAccessMode
  readonly url: string
  readonly urlWithPassword: string
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly expiresIn: DriveAccessExpiresIn
  readonly expiresAt: string | null
  readonly sourceFolderItemId: string | null
  readonly sourceFolderName: string | null
  readonly entryPath: string | null
  readonly fileCount: number
  readonly totalBytes: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastPublishedAt: string | null
}

export interface DriveSitePreflightDto {
  readonly sourceFolderItemId: string
  readonly sourceFolderName: string
  readonly htmlFiles: readonly string[]
  readonly defaultEntryPath: string | null
  readonly fileCount: number
  readonly totalBytes: string
  readonly includesJavaScript: boolean
}

export interface DriveSiteListPageDto {
  readonly items: readonly DriveSiteDto[]
  readonly total: number
  readonly page: DriveBrowserChildrenPageDto
}

export interface DriveDocumentImageSource {
  readonly id: string
  readonly imageKey: string
  readonly src: string
  readonly kind: DriveDocumentImageSourceKind
  readonly occurrenceCount: number
  readonly altText?: string
  readonly previewUrl?: string
  readonly assetId?: string
  readonly assetOwnerId?: string
  readonly assetOwnerName?: string
  readonly canImport: boolean
  readonly status: DriveDocumentImageSourceStatus
  readonly reason?: string
  readonly importDisabledReason?: DriveDocumentImageImportDisabledReason
}

export interface DriveDocumentImageSourcesDto {
  readonly itemId: string
  readonly versionId: string | null
  readonly canImport: boolean
  readonly sources: readonly DriveDocumentImageSource[]
  readonly summary: {
    readonly total: number
    readonly ownerAsset: number
    readonly collaboratorAsset: number
    readonly external: number
    readonly invalid: number
    readonly unsupported: number
    readonly importable: number
  }
}

export interface DriveDocumentImageImportRequest {
  readonly baseVersionId: string
  readonly sources: readonly { readonly src: string }[]
}

export interface DriveDocumentImageImportResult {
  readonly itemId: string
  readonly versionId: string
  readonly imported: readonly {
    readonly previousSrc: string
    readonly nextSrc: string
    readonly assetId: string
    readonly size: string
  }[]
  readonly failed: readonly {
    readonly src: string
    readonly reason: "unreachable" | "unsupported" | "too_large" | "quota" | "changed" | "unknown"
    readonly message: string
  }[]
  readonly summary: {
    readonly importedCount: number
    readonly failedCount: number
    readonly replacedOccurrenceCount: number
  }
}

export interface DriveSiteListInput {
  readonly offset?: number
  readonly limit?: number
  readonly search?: string
  readonly status?: DriveSiteStatus | "all"
}

export interface DriveFileVersionPinInput {
  readonly isPinned: boolean
}

export interface DriveFileVersionDownloadResultDto {
  readonly itemId: string
  readonly versionId: string
  readonly versionNumber: number
  readonly outputPath: string
}

export interface DriveShareDto {
  readonly id: string
  readonly shareId: string
  readonly itemId: string
  readonly enabled: boolean
  readonly url: string
  readonly urlWithPassword: string
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly expiresAt: string | null
  readonly accessMode: DriveShareAccessMode
  readonly editorEmails: readonly string[]
  readonly createdAt: string
}

export interface DriveShareListItemDto {
  readonly id: string
  readonly shareId: string
  readonly itemId: string
  readonly itemName: string
  readonly itemType: DriveShareItemType
  readonly sourceDeleted: boolean
  readonly url: string
  readonly urlWithPassword: string
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly expiresAt: string | null
  readonly accessMode: DriveShareAccessMode
  readonly editorEmails: readonly string[]
  readonly createdAt: string
}

export interface DriveUsageDto {
  readonly usedBytes: string
  readonly reservedBytes: string
  readonly quotaBytes: string
}

export interface DriveStatsDto extends DriveUsageDto {
  readonly itemCount: number
  readonly fileCount: number
  readonly folderCount: number
}

export interface DriveItemTreeEntryDto extends DriveItemDto {
  readonly path: string
  readonly depth: number
}

export interface DriveItemTreeListInput {
  readonly parentId?: string | null
  readonly offset?: number
  readonly limit?: number
}

export interface DriveItemTreeListPageDto {
  readonly items: readonly DriveItemTreeEntryDto[]
  readonly total: number
  readonly fileCount: number
  readonly folderCount: number
  readonly hasMore: boolean
  readonly nextOffset: number | null
}

export interface DriveFolderPathEnsureInput {
  readonly parentId?: string | null
  readonly segments: readonly string[]
}

export interface DriveFolderPathEnsureResultDto {
  readonly item: DriveItemDto
  readonly created: readonly DriveItemDto[]
  readonly reused: readonly DriveItemDto[]
}

export interface DriveReorganizationMoveInput {
  readonly itemId: string
  readonly targetParentId: string | null
}

export interface DriveReorganizationPreviewInput {
  readonly moves: readonly DriveReorganizationMoveInput[]
}

export interface DriveReorganizationPlannedMoveDto {
  readonly itemId: string
  readonly name: string
  readonly fromParentId: string | null
  readonly targetParentId: string | null
  readonly updatedAt: string
}

export interface DriveReorganizationSkippedMoveDto {
  readonly itemId: string
  readonly reason: string
}

export interface DriveReorganizationConflictDto {
  readonly itemId?: string
  readonly reason: string
}

export interface DriveReorganizationPreviewDto {
  readonly planId: string
  readonly expiresAt: string
  readonly summary: {
    readonly moveCount: number
    readonly skippedCount: number
    readonly conflictCount: number
  }
  readonly moves: readonly DriveReorganizationPlannedMoveDto[]
  readonly skipped: readonly DriveReorganizationSkippedMoveDto[]
  readonly conflicts: readonly DriveReorganizationConflictDto[]
}

export interface DriveReorganizationApplyInput {
  readonly planId: string
}

export interface DriveReorganizationAppliedMoveDto {
  readonly itemId: string
  readonly fromParentId: string | null
  readonly targetParentId: string | null
}

export interface DriveReorganizationApplyResultDto {
  readonly ok: true
  readonly movedCount: number
  readonly skippedCount: number
  readonly moves: readonly DriveReorganizationAppliedMoveDto[]
  readonly moveDetailsTruncated?: boolean
}

export interface DriveBrowserItemDto {
  readonly id: string
  readonly name: string
  readonly type: DriveItemType
  readonly size: string
  readonly mimeType: string | null
  readonly updatedAt: string
  readonly previewKind: DriveBrowserPreviewKind
  readonly browserUrl: string
  readonly downloadUrl: string | null
}

export interface DriveBrowserBreadcrumbDto {
  readonly id: string
  readonly name: string
  readonly browserUrl: string
}

export interface DriveMarkdownOutlineItemDto {
  readonly id: string
  readonly text: string
  readonly depth: number
  readonly children: readonly DriveMarkdownOutlineItemDto[]
}

export interface DriveBrowserPreviewDto {
  readonly kind: DriveBrowserPreviewKind
  readonly text: string | null
  readonly html: string | null
  readonly outline: readonly DriveMarkdownOutlineItemDto[] | null
  readonly truncated: boolean
  readonly imageUrl: string | null
  readonly visitUrl: string | null
}

export interface DriveBrowserEditDto {
  readonly canEdit: boolean
  readonly editorKind: DriveBrowserEditKind
  readonly currentVersionId: string | null
  readonly maxInlineEditBytes: string
  readonly reason: DriveBrowserEditUnavailableReason | null
}

export interface DriveBrowserAnnotationCapabilityDto {
  readonly canComment: boolean
  readonly reason: DriveBrowserAnnotationUnavailableReason | null
}

export interface DriveFileTextUpdateInput {
  readonly contentType: "text"
  readonly text: string
  readonly baseVersionId: string
}

export interface DriveFileContentUpdateResult {
  readonly item: DriveItemDto
  readonly version: DriveFileVersionDto
}

export interface DriveBrowserChildrenPageDto {
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
  readonly nextOffset: number | null
}

export interface DrivePublicLinksPageInput {
  readonly offset?: number
  readonly limit?: number
  readonly search?: string
}

export interface DrivePublicLinksPageDto<TItem> {
  readonly items: readonly TItem[]
  readonly page: DriveBrowserChildrenPageDto
}

export type DriveShareListPageDto = DrivePublicLinksPageDto<DriveShareListItemDto>

export interface DriveBrowserSnapshotDto {
  readonly context: DriveBrowserAccessContext
  readonly surface: DriveBrowserSurface
  readonly current: DriveBrowserItemDto
  readonly breadcrumbs: readonly DriveBrowserBreadcrumbDto[]
  readonly children: readonly DriveBrowserItemDto[]
  readonly childrenPage?: DriveBrowserChildrenPageDto
  readonly preview: DriveBrowserPreviewDto | null
  readonly edit: DriveBrowserEditDto | null
  readonly annotation: DriveBrowserAnnotationCapabilityDto | null
  readonly canDownload: boolean
  readonly canZip: boolean
}

export interface DriveBrowserPasswordRequiredDto {
  readonly passwordRequired: true
  readonly message: string
}

export const DRIVE_SHARE_UNLOCK_REQUIRED_ERROR_CODE = "DRIVE_SHARE_UNLOCK_REQUIRED"

export const DRIVE_LINK_SUPPORTED_PATH_PREFIXES = [DRIVE_PUBLIC_PATH_PREFIX, DRIVE_SITE_PATH_PREFIX, DRIVE_PUBLIC_ASSET_PATH_PREFIX] as const
export const DRIVE_LINK_INTAKE_SCOPES = ["entry", "text", "all"] as const
export const DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES = 200
export const DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES = 50 * 1024 * 1024

export type DriveLinkType = "share" | "share_item" | "site" | "site_path" | "public_asset"
export type DriveLinkRefKind = "share" | "site" | "public_asset"
export type DriveLinkAccessStatus = "ok" | "password_required" | "login_required" | "not_found"
export type DriveLinkRootType = "file" | "folder" | "site" | "asset" | "protected"
export type DriveLinkEntryType = "file" | "folder" | "site" | "asset"
export type DriveLinkPreviewKind = DriveBrowserPreviewKind | "html" | "text"
export type DriveLinkMaterializeScope = typeof DRIVE_LINK_INTAKE_SCOPES[number]
export type DriveLinkMaterializedFileKind = "markdown" | "html" | "text" | "image" | "binary" | "folder"

export interface DriveLinkAccessDto {
  readonly status: DriveLinkAccessStatus
  readonly canRead: boolean
  readonly canList: boolean
  readonly canReadText: boolean
  readonly canDownload: boolean
}

export interface DriveLinkRefDto {
  readonly kind: DriveLinkRefKind
  readonly shareId: string | null
  readonly itemId: string | null
  readonly siteId: string | null
  readonly path: string | null
  readonly assetId: string | null
}

export interface DriveLinkRootDto {
  readonly name: string
  readonly type: DriveLinkRootType
  readonly previewKind: DriveLinkPreviewKind
}

export interface DriveLinkResolveInput {
  readonly url: string
  readonly password?: string
}

export interface DriveLinkResolveDto {
  readonly ok: true
  readonly linkType: DriveLinkType
  readonly access: DriveLinkAccessDto
  readonly root: DriveLinkRootDto
  readonly ref: DriveLinkRefDto
}

export interface DriveLinkPageDto {
  readonly hasMore: boolean
  readonly nextOffset: number | null
}

export interface DriveLinkEntryDto {
  readonly path: string
  readonly name: string
  readonly type: DriveLinkEntryType
  readonly mimeType: string | null
  readonly previewKind: DriveLinkPreviewKind
  readonly size: string
  readonly itemId?: string | null
}

export interface DriveLinkListInput extends DriveLinkResolveInput {
  readonly path?: string
  readonly itemId?: string
  readonly offset?: number
  readonly limit?: number
}

export interface DriveLinkListDto {
  readonly items: readonly DriveLinkEntryDto[]
  readonly page: DriveLinkPageDto
}

export interface DriveLinkReadTextInput extends DriveLinkResolveInput {
  readonly itemId?: string
  readonly path?: string
  readonly maxBytes?: number
}

export interface DriveLinkReadTextDto {
  readonly path: string
  readonly mimeType: string | null
  readonly previewKind: DriveLinkPreviewKind
  readonly text: string
  readonly truncated: boolean
  readonly source: {
    readonly linkType: DriveLinkType
    readonly versionId?: string | null
  }
}

export interface DriveLinkMaterializeInput extends DriveLinkResolveInput {
  readonly scope?: DriveLinkMaterializeScope
  readonly maxFiles?: number
  readonly maxBytes?: number
}

export interface DriveLinkMaterializedFileDto {
  readonly relativePath: string
  readonly kind: DriveLinkMaterializedFileKind
  readonly size: string
}

export interface DriveLinkSkippedEntryDto {
  readonly path: string
  readonly reason: string
}

export interface DriveLinkMaterializeDto {
  readonly localRootPath: string
  readonly manifestPath: string
  readonly entryPath: string | null
  readonly files: readonly DriveLinkMaterializedFileDto[]
  readonly skipped: readonly DriveLinkSkippedEntryDto[]
  readonly warnings: readonly string[]
}

export interface DriveLinkDownloadFileInput extends DriveLinkResolveInput {
  readonly itemId?: string
  readonly path?: string
  readonly outputPath?: string
}

export interface DriveLinkDownloadFileDto {
  readonly localPath: string
  readonly mimeType: string | null
  readonly size: string
}

export type DriveAnnotationTargetKind = "textRange"
export type DriveAnnotationAnchorStatus = "attached" | "shifted" | "orphaned"
export const DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH = 1000

export interface DriveAnnotationAuthorDto {
  readonly id: string
  readonly email: string | null
  readonly handle: string | null
}

export interface DriveAnnotationTextRangeTargetV1 {
  readonly schemaVersion: 1
  readonly kind: "textRange"
  readonly surface: "markdownRenderedText"
  readonly range: {
    readonly start: number
    readonly end: number
  }
  readonly quote: {
    readonly exact: string
    readonly prefix: string
    readonly suffix: string
  }
  readonly source?: {
    readonly startOffset: number
    readonly endOffset: number
    readonly lineStart: number
    readonly lineEnd: number
  }
  readonly blockHint?: {
    readonly path: readonly number[]
    readonly type: string
    readonly textHash: string
  }
}

export type DriveAnnotationTargetDto = DriveAnnotationTextRangeTargetV1

export interface DriveAnnotationCommentDto {
  readonly id: string
  readonly threadId: string
  readonly parentCommentId: string | null
  readonly body: string
  readonly author: DriveAnnotationAuthorDto
  readonly createdAt: string
  readonly updatedAt: string
  readonly editedAt: string | null
  readonly deletedAt: string | null
  readonly deleted: boolean
  readonly permissions: {
    readonly canEdit: boolean
    readonly canDelete: boolean
  }
}

export interface DriveAnnotationThreadDto {
  readonly id: string
  readonly itemId: string
  readonly baseVersionId: string | null
  readonly targetKind: DriveAnnotationTargetKind
  readonly target: DriveAnnotationTargetDto
  readonly anchorStatus: DriveAnnotationAnchorStatus
  readonly author: DriveAnnotationAuthorDto
  readonly comments: readonly DriveAnnotationCommentDto[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly permissions: {
    readonly canDelete: boolean
  }
}

export interface DriveAnnotationCreateInput {
  readonly baseVersionId?: string | null
  readonly targetKind: DriveAnnotationTargetKind
  readonly target: DriveAnnotationTargetDto
  readonly body: string
}

export interface DriveAnnotationReplyInput {
  readonly parentCommentId?: string | null
  readonly body: string
}

export interface DriveAnnotationCommentUpdateInput {
  readonly body: string
}

export function buildDriveShareUrl(input: {
  readonly publicAppUrl: string
  readonly shareId: string
}): string {
  return `${normalizePublicAppUrl(input.publicAppUrl)}${DRIVE_PUBLIC_PATH_PREFIX}/${encodeURIComponent(input.shareId)}`
}

export function buildDrivePublicAssetUrl(input: {
  readonly publicAppUrl: string
  readonly assetId: string
}): string {
  return `${normalizePublicAppUrl(input.publicAppUrl)}${DRIVE_PUBLIC_ASSET_PATH_PREFIX}/${encodeURIComponent(input.assetId)}`
}

export function parseDrivePublicAssetUrl(value: string): { readonly assetId: string } | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  const { pathname } = url
  const prefix = `${DRIVE_PUBLIC_ASSET_PATH_PREFIX}/`
  if (!pathname.startsWith(prefix)) return null
  const encodedAssetId = pathname.slice(prefix.length)
  if (!encodedAssetId || encodedAssetId.includes("/")) return null
  let assetId: string
  try {
    assetId = decodeURIComponent(encodedAssetId)
  } catch {
    return null
  }
  return isDrivePublicAssetId(assetId) ? { assetId } : null
}

export function buildDriveSiteUrl(input: {
  readonly publicAppUrl: string
  readonly siteId: string
}): string {
  return `${normalizePublicAppUrl(input.publicAppUrl)}${DRIVE_SITE_PATH_PREFIX}/${encodeURIComponent(input.siteId)}/`
}

export function isDrivePublicAssetId(value: string): boolean {
  return /^asset_[0-9A-Za-z]{32}$/u.test(value)
}

export function inferDrivePublicAssetMimeType(name: string): string | null {
  const extension = name.split(".").pop()?.toLowerCase()
  if (!extension) return null
  return DRIVE_PUBLIC_ASSET_MIME_BY_EXTENSION[extension as keyof typeof DRIVE_PUBLIC_ASSET_MIME_BY_EXTENSION] ?? null
}

export function drivePublicAssetContentKind(mimeType: string | null | undefined): DrivePublicAssetContentKind | null {
  const normalized = mimeType?.trim().toLowerCase()
  if (!normalized) return null
  if ((Object.values(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION) as readonly string[]).includes(normalized)) return "image"
  if ((Object.values(DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION) as readonly string[]).includes(normalized)) return "document"
  return null
}

export function isDrivePublicAssetTextMimeType(mimeType: string | null | undefined): boolean {
  const normalized = mimeType?.trim().toLowerCase()
  return normalized === "text/plain" || normalized === "text/markdown" || normalized === "text/csv"
}

export function buildOwnerDriveBrowserUrl(itemId: string): string {
  return `${DRIVE_OWNER_BROWSER_PATH_PREFIX}/${encodeURIComponent(itemId)}`
}

export function buildOwnerDriveDownloadUrl(itemId: string): string {
  return `${buildOwnerDriveBrowserUrl(itemId)}/download`
}

export function buildOwnerDriveRenderUrl(itemId: string): string {
  return `${buildOwnerDriveBrowserUrl(itemId)}/render`
}

export function buildConsoleDriveRootUrl(): string {
  return DRIVE_CONSOLE_BROWSER_PATH_PREFIX
}

export function buildConsoleDriveBrowserUrl(folderId: string): string {
  return `${DRIVE_CONSOLE_BROWSER_PATH_PREFIX}/folders/${encodeURIComponent(folderId)}`
}

export function buildConsoleDriveItemBrowserUrl(itemId: string): string {
  return `${DRIVE_CONSOLE_BROWSER_PATH_PREFIX}/items/${encodeURIComponent(itemId)}?surface=console`
}

export function buildShareDriveBrowserUrl(shareId: string, itemId?: string | null): string {
  const rootUrl = `${DRIVE_SHARE_BROWSER_PATH_PREFIX}/${encodeURIComponent(shareId)}`
  return itemId ? `${rootUrl}/items/${encodeURIComponent(itemId)}` : rootUrl
}

export function buildShareDriveDownloadUrl(shareId: string, itemId?: string | null): string {
  return `${buildShareDriveBrowserUrl(shareId, itemId)}/download`
}

export function buildShareDriveRenderUrl(shareId: string, itemId?: string | null): string {
  return `${buildShareDriveBrowserUrl(shareId, itemId)}/render`
}

export function buildDriveUrlWithPassword(url: string, password: string | null | undefined): string {
  if (!password) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.set("password", password)
    return parsed.toString()
  } catch {
    return buildRelativeUrlWithPassword(url, password)
  }
}

export function maskDriveShareUrl(value: string): string {
  return maskDriveBrowserUrl(value)
}

export function maskDriveBrowserUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const userinfoChanged = parsed.username !== "" || parsed.password !== ""
    parsed.username = ""
    parsed.password = ""
    const maskedPathname = maskDriveBrowserPath(parsed.pathname)
    const pathChanged = maskedPathname !== parsed.pathname
    parsed.pathname = maskedPathname
    const queryChanged = maskSensitiveDriveSearchParams(parsed.searchParams)
    return userinfoChanged || pathChanged || queryChanged ? parsed.toString() : value
  } catch {
    return maskSensitiveDriveQuery(maskDriveBrowserPath(value))
  }
}

function normalizePublicAppUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "")
}

function maskDriveBrowserPath(value: string): string {
  return value
    .replace(/\/drive\/items\/[^/?#]+/u, "/drive/items/***")
    .replace(/\/console\/drive\/folders\/[^/?#]+/u, "/console/drive/folders/***")
    .replace(/\/console\/drive\/items\/[^/?#]+/u, "/console/drive/items/***")
    .replace(/\/share\/[^/?#]+/u, "/share/***")
    .replace(/(\/share\/\*\*\*\/items\/)[^/?#]+/u, "$1***")
    .replace(/\/sites\/[^/?#]+/u, "/sites/***")
    .replace(/\/files\/[^/?#]+/u, "/files/***")
}

function buildRelativeUrlWithPassword(url: string, password: string): string {
  const hashIndex = url.indexOf("#")
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : ""
  const queryIndex = beforeHash.indexOf("?")
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : ""
  const params = new URLSearchParams(query)
  params.set("password", password)
  return `${path}?${params.toString()}${hash}`
}

function maskSensitiveDriveQuery(value: string): string {
  try {
    const parsed = new URL(value)
    const changed = maskSensitiveDriveSearchParams(parsed.searchParams)
    return changed ? parsed.toString() : value
  } catch {
    return value.replace(/([?&](?:password|token|access_token|api_?key|signature|sig)=)[^&#]*/giu, "$1***")
  }
}

function maskSensitiveDriveSearchParams(params: URLSearchParams): boolean {
  let changed = false
  for (const key of [...params.keys()]) {
    if (isSensitiveDriveQueryKey(key)) {
      params.set(key, "***")
      changed = true
    }
  }
  return changed
}

function isSensitiveDriveQueryKey(key: string): boolean {
  return /^(?:password|token|access_token|api_?key|signature|sig)$/iu.test(key)
}
