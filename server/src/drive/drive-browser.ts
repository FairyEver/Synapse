import {
  buildConsoleDriveBrowserUrl,
  buildConsoleDriveChildBrowserUrl,
  buildConsoleDriveRootUrl,
  buildOwnerDriveBrowserUrl,
  buildOwnerDriveChildBrowserUrl,
  buildOwnerDriveChildDownloadUrl,
  buildOwnerDriveChildRenderUrl,
  buildOwnerDriveChildZipUrl,
  buildOwnerDriveDownloadUrl,
  buildOwnerDriveRenderUrl,
  buildOwnerDriveZipUrl,
  buildShareDriveBrowserUrl,
  buildShareDriveChildZipUrl,
  buildShareDriveDownloadUrl,
  buildShareDriveZipUrl,
  type DriveBrowserBreadcrumbDto,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewDto,
  type DriveBrowserPreviewKind,
  type DriveBrowserSurface,
  type DriveItemType,
} from "@synapse/shared"

export const DRIVE_BROWSER_TEXT_PREVIEW_MAX_BYTES = 128 * 1024
export const DRIVE_CONSOLE_ROOT_ID = "root"

export type DriveBrowserSourceItem = {
  readonly id: string
  readonly name: string
  readonly type: DriveItemType
  readonly size: string
  readonly mimeType: string | null
  readonly updatedAt: string
}

export type DriveBrowserRouteContext =
  | {
    readonly context: "owner"
    readonly surface: DriveBrowserSurface
    readonly rootItemId: string
  }
  | {
    readonly context: "share"
    readonly surface: "standalone"
    readonly shareId: string
    readonly rootItemId: string
  }

export function resolveDriveBrowserPreviewKind(item: Pick<DriveBrowserSourceItem, "type" | "name" | "mimeType">): DriveBrowserPreviewKind {
  if (item.type === "folder") return "download-only"
  const mimeType = item.mimeType?.toLowerCase() ?? ""
  const lowerName = item.name.toLowerCase()
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType === "text/html" || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) return "html-source"
  if (mimeType.startsWith("text/")) return "text"
  if (isKnownTextName(lowerName)) return "text"
  if (isKnownArchiveName(lowerName) || isKnownArchiveMimeType(mimeType)) return "download-only"
  return "download-only"
}

export function buildDriveBrowserItemDto(input: {
  readonly item: DriveBrowserSourceItem
  readonly route: DriveBrowserRouteContext
}): DriveBrowserItemDto {
  const previewKind = resolveDriveBrowserPreviewKind(input.item)
  return {
    id: input.item.id,
    name: input.item.name,
    type: input.item.type,
    size: input.item.size,
    mimeType: input.item.mimeType,
    updatedAt: input.item.updatedAt,
    previewKind,
    browserUrl: buildBrowserUrl(input.route, input.item.id),
    downloadUrl: buildDownloadUrl(input.route, input.item),
  }
}

export function buildConsoleDriveRootItemDto(updatedAt = new Date(0)): DriveBrowserItemDto {
  return {
    id: DRIVE_CONSOLE_ROOT_ID,
    name: "网盘",
    type: "folder",
    size: "0",
    mimeType: null,
    updatedAt: updatedAt.toISOString(),
    previewKind: "download-only",
    browserUrl: buildConsoleDriveRootUrl(),
    downloadUrl: null,
  }
}

export function buildDriveBrowserBreadcrumb(input: {
  readonly item: DriveBrowserSourceItem
  readonly route: DriveBrowserRouteContext
}): DriveBrowserBreadcrumbDto {
  return {
    id: input.item.id,
    name: input.item.name,
    browserUrl: buildBrowserUrl(input.route, input.item.id),
  }
}

export function buildConsoleDriveRootBreadcrumb(): DriveBrowserBreadcrumbDto {
  return {
    id: DRIVE_CONSOLE_ROOT_ID,
    name: "网盘",
    browserUrl: buildConsoleDriveRootUrl(),
  }
}

export function buildDriveBrowserPreview(input: {
  readonly item: DriveBrowserSourceItem
  readonly route: DriveBrowserRouteContext
  readonly text?: string | null
  readonly truncated?: boolean
  readonly imageUrl?: string | null
}): DriveBrowserPreviewDto {
  const kind = resolveDriveBrowserPreviewKind(input.item)
  return {
    kind,
    text: kind === "text" || kind === "html-source" ? input.text ?? "" : null,
    truncated: kind === "text" || kind === "html-source" ? input.truncated ?? false : false,
    imageUrl: kind === "image" ? input.imageUrl ?? null : null,
    visitUrl: input.route.context === "owner" && kind === "html-source"
      ? buildRenderUrl(input.route, input.item.id)
      : null,
  }
}

export function shouldReadDriveBrowserTextPreview(kind: DriveBrowserPreviewKind): boolean {
  return kind === "text" || kind === "html-source"
}

export function shouldCreateDriveBrowserImagePreview(kind: DriveBrowserPreviewKind): boolean {
  return kind === "image"
}

export function buildDriveBrowserZipUrl(input: DriveBrowserRouteContext & { readonly itemId: string }): string | null {
  if (input.context === "owner") {
    return input.itemId === input.rootItemId
      ? buildOwnerDriveZipUrl(input.rootItemId)
      : buildOwnerDriveChildZipUrl(input.rootItemId, input.itemId)
  }
  return input.itemId === input.rootItemId
    ? buildShareDriveZipUrl(input.shareId)
    : buildShareDriveChildZipUrl(input.shareId, input.itemId)
}

function buildBrowserUrl(route: DriveBrowserRouteContext, itemId: string): string {
  if (route.context === "owner") {
    if (route.surface === "console") {
      return itemId === route.rootItemId
        ? buildConsoleDriveBrowserUrl(route.rootItemId)
        : buildConsoleDriveChildBrowserUrl(route.rootItemId, itemId)
    }
    return itemId === route.rootItemId
      ? buildOwnerDriveBrowserUrl(route.rootItemId)
      : buildOwnerDriveChildBrowserUrl(route.rootItemId, itemId)
  }
  return buildShareDriveBrowserUrl(route.shareId, itemId === route.rootItemId ? null : itemId)
}

function buildDownloadUrl(route: DriveBrowserRouteContext, item: DriveBrowserSourceItem): string | null {
  if (item.type === "folder") return buildDriveBrowserZipUrl({ ...route, itemId: item.id })
  if (route.context === "owner") {
    return item.id === route.rootItemId
      ? buildOwnerDriveDownloadUrl(route.rootItemId)
      : buildOwnerDriveChildDownloadUrl(route.rootItemId, item.id)
  }
  return buildShareDriveDownloadUrl(route.shareId, item.id === route.rootItemId ? null : item.id)
}

function buildRenderUrl(route: DriveBrowserRouteContext, itemId: string): string | null {
  if (route.context !== "owner") return null
  return itemId === route.rootItemId
    ? buildOwnerDriveRenderUrl(route.rootItemId)
    : buildOwnerDriveChildRenderUrl(route.rootItemId, itemId)
}

function isKnownTextName(lowerName: string): boolean {
  return [".txt", ".md", ".json", ".csv"].some((extension) => lowerName.endsWith(extension))
}

function isKnownArchiveName(lowerName: string): boolean {
  return [".zip", ".tar", ".tar.gz", ".tgz", ".gz", ".rar", ".7z"].some((extension) => lowerName.endsWith(extension))
}

function isKnownArchiveMimeType(mimeType: string): boolean {
  return [
    "application/zip",
    "application/x-zip-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-gzip",
    "application/vnd.rar",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
  ].includes(mimeType)
}
