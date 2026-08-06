import {
  buildConsoleDriveBrowserUrl,
  buildConsoleDriveItemBrowserUrl,
  buildConsoleDriveRootUrl,
  buildOwnerDriveBrowserUrl,
  buildOwnerDriveDownloadUrl,
  buildOwnerDriveRenderUrl,
  buildShareDriveBrowserUrl,
  buildShareDriveDownloadUrl,
  buildShareDriveRenderUrl,
  type DriveBrowserBreadcrumbDto,
  type DriveBrowserItemDto,
  type DriveMarkdownOutlineItemDto,
  type DriveBrowserPreviewDto,
  type DriveBrowserPreviewKind,
  type DriveBrowserSurface,
  type DriveItemType,
  isDriveMarkdownItem,
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
  if (isKnownImageName(lowerName)) return "image"
  if (mimeType === "text/html" || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) return "html-source"
  if (isDriveMarkdownItem(item)) return "markdown"
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
    browserUrl: buildBrowserUrl(input.route, input.item),
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
    browserUrl: buildBrowserUrl(input.route, input.item),
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
  readonly html?: string | null
  readonly outline?: readonly DriveMarkdownOutlineItemDto[] | null
  readonly truncated?: boolean
  readonly imageUrl?: string | null
  readonly relativeImages?: readonly {
    readonly src: string
    readonly resolvedUrl: string | null
  }[]
  readonly markdownProjection?: DriveBrowserPreviewDto["markdownProjection"]
}): DriveBrowserPreviewDto {
  const kind = resolveDriveBrowserPreviewKind(input.item)
  const textPreview = isTextPreviewKind(kind)
  return {
    kind,
    text: textPreview ? input.text ?? "" : null,
    html: kind === "markdown" ? input.html ?? null : null,
    outline: kind === "markdown" ? input.outline ?? null : null,
    truncated: textPreview ? input.truncated ?? false : false,
    imageUrl: kind === "image" ? input.imageUrl ?? null : null,
    visitUrl: kind === "html-source"
      ? buildRenderUrl(input.route, input.item.id)
      : null,
    relativeImages: kind === "markdown" ? input.relativeImages ?? [] : [],
    markdownProjection: kind === "markdown" ? input.markdownProjection ?? null : null,
  }
}

export function shouldReadDriveBrowserTextPreview(kind: DriveBrowserPreviewKind): boolean {
  return isTextPreviewKind(kind)
}

export function shouldCreateDriveBrowserImagePreview(kind: DriveBrowserPreviewKind): boolean {
  return kind === "image"
}

export function buildDriveBrowserZipUrl(input: DriveBrowserRouteContext & { readonly itemId: string }): string | null {
  return input.context === "owner"
    ? buildOwnerDriveDownloadUrl(input.itemId)
    : buildShareDriveDownloadUrl(input.shareId, input.itemId === input.rootItemId ? null : input.itemId)
}

function buildBrowserUrl(route: DriveBrowserRouteContext, item: DriveBrowserSourceItem): string {
  if (route.context === "owner") {
    if (route.surface !== "console") return buildOwnerDriveBrowserUrl(item.id)
    return item.type === "folder"
      ? buildConsoleDriveBrowserUrl(item.id)
      : buildConsoleDriveItemBrowserUrl(item.id)
  }
  return buildShareDriveBrowserUrl(route.shareId, item.id === route.rootItemId ? null : item.id)
}

function isKnownImageName(name: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|avif|ico)$/i.test(name)
}

function buildDownloadUrl(route: DriveBrowserRouteContext, item: DriveBrowserSourceItem): string | null {
  if (item.type === "folder") return buildDriveBrowserZipUrl({ ...route, itemId: item.id })
  if (route.context === "owner") {
    return buildOwnerDriveDownloadUrl(item.id)
  }
  return buildShareDriveDownloadUrl(route.shareId, item.id === route.rootItemId ? null : item.id)
}

function buildRenderUrl(route: DriveBrowserRouteContext, itemId: string): string | null {
  return route.context === "owner"
    ? buildOwnerDriveRenderUrl(itemId)
    : buildShareDriveRenderUrl(route.shareId, itemId === route.rootItemId ? null : itemId)
}

function isKnownTextName(lowerName: string): boolean {
  return [".txt", ".json", ".csv"].some((extension) => lowerName.endsWith(extension))
}

function isTextPreviewKind(kind: DriveBrowserPreviewKind): boolean {
  return kind === "text" || kind === "html-source" || kind === "markdown"
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
