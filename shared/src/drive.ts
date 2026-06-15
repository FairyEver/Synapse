export const DRIVE_PUBLIC_PATH_PREFIX = "/files"
export const DRIVE_OWNER_BROWSER_PATH_PREFIX = "/drive/items"
export const DRIVE_CONSOLE_BROWSER_PATH_PREFIX = "/drive"
export const DRIVE_SHARE_BROWSER_PATH_PREFIX = DRIVE_PUBLIC_PATH_PREFIX
export const DRIVE_PAGE_PUBLIC_PATH_PREFIX = "/pages"
export const DRIVE_SITE_PUBLIC_PATH_PREFIX = "/sites"

export type DriveItemType = "file" | "folder"
export type DrivePublicationType = "page" | "site"
export type DrivePublicationStatus = "active" | "disabled"
export type DriveShareItemType = "file" | "folder"
export type DriveStorageStatus = "pending" | "active" | "delete_pending" | "deleted" | "failed"
export type DriveUploadSessionStatus = "pending" | "completed" | "cancelled" | "expired" | "failed"
export type DriveAccessExpiresIn = "3d" | "7d" | "30d" | "1y" | "forever"
export type DriveBrowserAccessContext = "owner" | "share"
export type DriveBrowserSurface = "standalone" | "console"
export type DriveBrowserPreviewKind = "image" | "text" | "html-source" | "markdown" | "download-only"

export interface DriveAccessSettingsInput {
  readonly passwordEnabled: boolean
  readonly expiresIn: DriveAccessExpiresIn
}

export const DRIVE_DEFAULT_ACCESS_SETTINGS: DriveAccessSettingsInput = {
  passwordEnabled: true,
  expiresIn: "3d",
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
  readonly urlWithPassword: string
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly expiresAt: string | null
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
  readonly urlWithPassword: string
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly expiresAt: string | null
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
  readonly urlWithPassword: string
  readonly passwordEnabled: boolean
  readonly password: string | null
  readonly expiresAt: string | null
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

export interface DriveReorganizationApplyResultDto {
  readonly ok: true
  readonly movedCount: number
  readonly skippedCount: number
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

export interface DriveBrowserPreviewDto {
  readonly kind: DriveBrowserPreviewKind
  readonly text: string | null
  readonly html: string | null
  readonly truncated: boolean
  readonly imageUrl: string | null
  readonly visitUrl: string | null
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
}

export interface DrivePublicLinksPageDto<TItem> {
  readonly items: readonly TItem[]
  readonly page: DriveBrowserChildrenPageDto
}

export type DrivePublicationListPageDto = DrivePublicLinksPageDto<DrivePublicationDto>
export type DriveShareListPageDto = DrivePublicLinksPageDto<DriveShareListItemDto>

export interface DriveBrowserSnapshotDto {
  readonly context: DriveBrowserAccessContext
  readonly surface: DriveBrowserSurface
  readonly current: DriveBrowserItemDto
  readonly breadcrumbs: readonly DriveBrowserBreadcrumbDto[]
  readonly children: readonly DriveBrowserItemDto[]
  readonly childrenPage?: DriveBrowserChildrenPageDto
  readonly preview: DriveBrowserPreviewDto | null
  readonly canDownload: boolean
  readonly canZip: boolean
}

export interface DriveBrowserPasswordRequiredDto {
  readonly passwordRequired: true
  readonly message: string
}

export function buildDriveShareUrl(input: {
  readonly publicAppUrl: string
  readonly shareId: string
}): string {
  return `${normalizePublicAppUrl(input.publicAppUrl)}${DRIVE_PUBLIC_PATH_PREFIX}/${encodeURIComponent(input.shareId)}`
}

export function buildOwnerDriveBrowserUrl(rootItemId: string): string {
  return `${DRIVE_OWNER_BROWSER_PATH_PREFIX}/${encodeURIComponent(rootItemId)}`
}

export function buildOwnerDriveChildBrowserUrl(rootItemId: string, itemId: string): string {
  return `${buildOwnerDriveBrowserUrl(rootItemId)}/items/${encodeURIComponent(itemId)}`
}

export function buildOwnerDriveDownloadUrl(rootItemId: string): string {
  return `${buildOwnerDriveBrowserUrl(rootItemId)}/download`
}

export function buildOwnerDriveChildDownloadUrl(rootItemId: string, itemId: string): string {
  return `${buildOwnerDriveChildBrowserUrl(rootItemId, itemId)}/download`
}

export function buildOwnerDriveZipUrl(rootItemId: string): string {
  return `${buildOwnerDriveBrowserUrl(rootItemId)}/zip`
}

export function buildOwnerDriveChildZipUrl(rootItemId: string, itemId: string): string {
  return `${buildOwnerDriveChildBrowserUrl(rootItemId, itemId)}/zip`
}

export function buildOwnerDriveRenderUrl(rootItemId: string): string {
  return `${buildOwnerDriveBrowserUrl(rootItemId)}/render`
}

export function buildOwnerDriveChildRenderUrl(rootItemId: string, itemId: string): string {
  return `${buildOwnerDriveChildBrowserUrl(rootItemId, itemId)}/render`
}

export function buildConsoleDriveRootUrl(): string {
  return DRIVE_CONSOLE_BROWSER_PATH_PREFIX
}

export function buildConsoleDriveBrowserUrl(rootItemId: string): string {
  return `${DRIVE_CONSOLE_BROWSER_PATH_PREFIX}/items/${encodeURIComponent(rootItemId)}`
}

export function buildConsoleDriveChildBrowserUrl(rootItemId: string, itemId: string): string {
  return `${buildConsoleDriveBrowserUrl(rootItemId)}/items/${encodeURIComponent(itemId)}`
}

export function buildShareDriveBrowserUrl(shareId: string, itemId?: string | null): string {
  const rootUrl = `${DRIVE_SHARE_BROWSER_PATH_PREFIX}/${encodeURIComponent(shareId)}`
  return itemId ? `${rootUrl}/items/${encodeURIComponent(itemId)}` : rootUrl
}

export function buildShareDriveDownloadUrl(shareId: string, itemId?: string | null): string {
  return `${buildShareDriveBrowserUrl(shareId, itemId)}/download`
}

export function buildShareDriveZipUrl(shareId: string): string {
  return `${buildShareDriveBrowserUrl(shareId)}/zip`
}

export function buildShareDriveChildZipUrl(shareId: string, itemId: string): string {
  return `${buildShareDriveBrowserUrl(shareId, itemId)}/zip`
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
    parsed.pathname = maskDriveBrowserPath(parsed.pathname)
    return maskPasswordQuery(parsed.toString())
  } catch {
    return maskPasswordQuery(maskDriveBrowserPath(value))
  }
}

export function maskDrivePublicUrl(value: string): string {
  try {
    const parsed = new URL(value)
    const parts = parsed.pathname.split("/")
    if (parts.length >= 3 && (parts[1] === "pages" || parts[1] === "sites")) {
      parts[2] = "***"
      parsed.pathname = parts.join("/")
      return maskPasswordQuery(parsed.toString())
    }
  } catch {
    return maskPasswordQuery(value
      .replace(/\/pages\/[^/?#]+/u, "/pages/***")
      .replace(/\/sites\/[^/?#]+/u, "/sites/***"))
  }
  return maskPasswordQuery(value
    .replace(/\/pages\/[^/?#]+/u, "/pages/***")
    .replace(/\/sites\/[^/?#]+/u, "/sites/***"))
}

function normalizePublicAppUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "")
}

function maskDriveBrowserPath(value: string): string {
  return value
    .replace(/\/drive\/items\/[^/?#]+/u, "/drive/items/***")
    .replace(/(\/drive\/items\/\*\*\*\/items\/)[^/?#]+/u, "$1***")
    .replace(/\/console\/drive\/items\/[^/?#]+/u, "/console/drive/items/***")
    .replace(/(\/console\/drive\/items\/\*\*\*\/items\/)[^/?#]+/u, "$1***")
    .replace(/\/files\/[^/?#]+/u, "/files/***")
    .replace(/(\/files\/\*\*\*\/items\/)[^/?#]+/u, "$1***")
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

function maskPasswordQuery(value: string): string {
  try {
    const parsed = new URL(value)
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase() === "password") parsed.searchParams.set(key, "***")
    }
    return parsed.toString()
  } catch {
    return value.replace(/([?&]password=)[^&#]*/giu, "$1***")
  }
}
