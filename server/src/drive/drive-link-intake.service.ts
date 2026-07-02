import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import {
  DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES,
  DRIVE_PUBLIC_ASSET_PATH_PREFIX,
  DRIVE_PUBLIC_PATH_PREFIX,
  DRIVE_SITE_PATH_PREFIX,
  type DriveBrowserItemDto,
  type DriveBrowserPreviewKind,
  type DriveBrowserSnapshotDto,
  type DriveLinkEntryDto,
  type DriveLinkDownloadFileInput,
  type DriveLinkListDto,
  type DriveLinkListInput,
  type DriveLinkPreviewKind,
  type DriveLinkReadTextDto,
  type DriveLinkReadTextInput,
  type DriveLinkRefDto,
  type DriveLinkResolveDto,
  type DriveLinkResolveInput,
  type DriveLinkType,
} from "@synapse/shared"

type PublicShareAccessResult =
  | {
    readonly status: "ok"
    readonly value: {
      readonly item: {
        readonly id: string
        readonly name: string
        readonly type: "file" | "folder"
        readonly mimeType: string | null
      }
    }
  }
  | { readonly status: "password_required" }

export type DriveLinkIntakeDeps = {
  readonly drive: {
    readonly resolvePublicShareAccess: (input: {
      readonly shareId: string
      readonly password?: string
      readonly cookie?: string
    }) => Promise<PublicShareAccessResult>
    readonly getShareBrowserSnapshot: (input: {
      readonly shareId: string
      readonly itemId?: string
      readonly password?: string
      readonly cookie?: string
      readonly childrenPage?: { readonly offset?: number; readonly limit?: number }
    }) => Promise<DriveBrowserSnapshotDto>
    readonly openShareBrowserItemDownload: (input: {
      readonly shareId: string
      readonly itemId?: string | null
      readonly password?: string
      readonly cookie?: string
    }) => Promise<
      | {
        readonly kind: "file"
        readonly stream: NodeJS.ReadableStream
        readonly fileName: string
        readonly size?: bigint
        readonly contentType?: string | null
      }
      | { readonly kind: "zip"; readonly filename: string; readonly entries: AsyncIterable<{ readonly path: string; readonly storageKey: string | null }> }
    >
  }
  readonly sites: {
    readonly resolvePublicSite: (siteId: string, input: {
      readonly cookie: string | null
      readonly password?: string
      readonly relativePath?: string
    }) => Promise<
      | { readonly status: "ok"; readonly asset: { readonly relativePath: string; readonly storageKey: string; readonly contentType: string | null } }
      | { readonly status: "password_required" | "not_found" | "disabled" | "expired" | "deleted" }
    >
    readonly listPublicSiteAssets: (siteId: string, input: {
      readonly cookie: string | null
      readonly password?: string
      readonly path?: string
      readonly offset?: number
      readonly limit?: number
    }) => Promise<
      | {
        readonly status: "ok"
        readonly assets: ReadonlyArray<{ readonly relativePath: string; readonly storageKey: string; readonly contentType: string | null; readonly size: bigint }>
        readonly page: { readonly hasMore: boolean; readonly nextOffset: number | null }
      }
      | { readonly status: "password_required" | "not_found" | "disabled" | "expired" | "deleted" }
    >
  }
  readonly publicAssets: {
    readonly resolvePublicAsset: (assetId: string, headers: Record<string, never>) => Promise<
      | { readonly status: "ok"; readonly name: string; readonly mimeType: string; readonly size: bigint; readonly storageKey: string }
      | { readonly status: "not_found" | "not_modified" }
    >
  }
  readonly storage: {
    readonly getObjectStream: (input: { readonly key: string }) => Promise<{
      readonly stream: NodeJS.ReadableStream
      readonly size?: bigint
      readonly contentType?: string | null
    }>
  }
  readonly publicAppUrl: string
}

type ParsedDriveLink =
  | { readonly linkType: "share"; readonly shareId: string; readonly itemId: string | null }
  | { readonly linkType: "site"; readonly siteId: string; readonly path: string }
  | { readonly linkType: "public_asset"; readonly assetId: string }

@Injectable()
export class DriveLinkIntakeService {
  constructor(private readonly deps: DriveLinkIntakeDeps) {}

  async resolve(input: DriveLinkResolveInput): Promise<DriveLinkResolveDto> {
    const parsed = parseDriveLinkUrl(input.url)
    if (parsed.linkType === "share") return this.resolveShare(parsed, input)
    if (parsed.linkType === "site") return this.resolveSite(parsed, input)
    return this.resolvePublicAsset(parsed)
  }

  async list(input: DriveLinkListInput): Promise<DriveLinkListDto> {
    const parsed = parseDriveLinkUrl(input.url)
    if (parsed.linkType === "public_asset") {
      throw new BadRequestException("公开素材链接没有目录。")
    }
    if (parsed.linkType === "site") {
      const access = await this.deps.sites.listPublicSiteAssets(parsed.siteId, {
        cookie: null,
        password: input.password,
        path: input.path ?? parsed.path,
        offset: input.offset,
        limit: input.limit,
      })
      if (access.status === "password_required") throw new BadRequestException("该链接需要密码。")
      if (access.status !== "ok") throw new NotFoundException("站点链接不存在。")
      return {
        items: access.assets.map(toDriveLinkSiteEntry),
        page: access.page,
      }
    }

    const itemId = await this.resolveShareItemIdByPath(parsed, input)
    const snapshot = await this.deps.drive.getShareBrowserSnapshot({
      shareId: parsed.shareId,
      itemId,
      password: input.password,
      cookie: undefined,
      childrenPage: { offset: input.offset, limit: input.limit },
    })

    return {
      items: snapshot.children.map(toDriveLinkEntry),
      page: {
        hasMore: Boolean(snapshot.childrenPage?.hasMore),
        nextOffset: snapshot.childrenPage?.nextOffset ?? null,
      },
    }
  }

  async readText(input: DriveLinkReadTextInput): Promise<DriveLinkReadTextDto> {
    const parsed = parseDriveLinkUrl(input.url)
    if (parsed.linkType === "public_asset") {
      throw new BadRequestException("该链接不是可读取的文本内容。")
    }
    if (parsed.linkType === "site") return this.readSiteText(parsed, input)
    return this.readShareText(parsed, input)
  }

  async openDownload(input: DriveLinkDownloadFileInput): Promise<{
    readonly stream: NodeJS.ReadableStream
    readonly fileName: string
    readonly size?: bigint
    readonly contentType?: string | null
  }> {
    const parsed = parseDriveLinkUrl(input.url)
    if (parsed.linkType === "public_asset") {
      const access = await this.deps.publicAssets.resolvePublicAsset(parsed.assetId, {})
      if (access.status !== "ok") throw new NotFoundException("公开素材不存在。")
      const object = await this.deps.storage.getObjectStream({ key: access.storageKey })
      return {
        stream: object.stream,
        fileName: access.name,
        size: object.size ?? access.size,
        contentType: object.contentType ?? access.mimeType,
      }
    }
    if (parsed.linkType === "site") {
      const access = await this.deps.sites.resolvePublicSite(parsed.siteId, {
        cookie: null,
        password: input.password,
        relativePath: input.path ?? parsed.path,
      })
      if (access.status === "password_required") throw new BadRequestException("该链接需要密码。")
      if (access.status !== "ok") throw new NotFoundException("站点链接不存在。")
      const object = await this.deps.storage.getObjectStream({ key: access.asset.storageKey })
      return {
        stream: object.stream,
        fileName: basenameFromRelativePath(access.asset.relativePath),
        size: object.size,
        contentType: object.contentType ?? access.asset.contentType,
      }
    }

    const itemId = await this.resolveShareItemIdByPath(parsed, input)
    const transfer = await this.deps.drive.openShareBrowserItemDownload({
      shareId: parsed.shareId,
      itemId,
      password: input.password,
      cookie: undefined,
    })
    if (transfer.kind === "zip") throw new BadRequestException("请选择具体文件下载。")
    return transfer
  }

  private async resolveShare(parsed: Extract<ParsedDriveLink, { readonly linkType: "share" }>, input: DriveLinkResolveInput): Promise<DriveLinkResolveDto> {
    const access = await this.deps.drive.resolvePublicShareAccess({
      shareId: parsed.shareId,
      password: input.password,
      cookie: undefined,
    })
    const ref = toShareRef(parsed)
    if (access.status === "password_required") {
      return passwordRequiredResolve(parsed.itemId ? "share_item" : "share", ref)
    }

    if (parsed.itemId) {
      const snapshot = await this.deps.drive.getShareBrowserSnapshot({
        shareId: parsed.shareId,
        itemId: parsed.itemId,
        password: input.password,
        cookie: undefined,
      })
      return {
        ok: true,
        linkType: "share_item",
        access: { status: "ok", canRead: true, canList: snapshot.current.type === "folder", canReadText: snapshot.current.previewKind !== "download-only", canDownload: true },
        root: { name: snapshot.current.name, type: snapshot.current.type, previewKind: snapshot.current.previewKind },
        ref,
      }
    }

    const previewKind = previewKindFromMime(access.value.item.mimeType, access.value.item.name)
    return {
      ok: true,
      linkType: parsed.itemId ? "share_item" : "share",
      access: { status: "ok", canRead: true, canList: access.value.item.type === "folder", canReadText: previewKind !== "download-only", canDownload: true },
      root: { name: access.value.item.name, type: access.value.item.type, previewKind },
      ref,
    }
  }

  private async resolveSite(parsed: Extract<ParsedDriveLink, { readonly linkType: "site" }>, input: DriveLinkResolveInput): Promise<DriveLinkResolveDto> {
    const ref = toSiteRef(parsed)
    const access = await this.deps.sites.resolvePublicSite(parsed.siteId, { cookie: null, password: input.password, relativePath: parsed.path })
    if (access.status === "password_required") return passwordRequiredResolve(parsed.path ? "site_path" : "site", ref)
    if (access.status !== "ok") throw new NotFoundException("站点链接不存在。")

    const previewKind = previewKindFromMime(access.asset.contentType, access.asset.relativePath)
    return {
      ok: true,
      linkType: parsed.path ? "site_path" : "site",
      access: { status: "ok", canRead: true, canList: true, canReadText: previewKind !== "download-only", canDownload: true },
      root: { name: access.asset.relativePath || "index.html", type: "site", previewKind },
      ref,
    }
  }

  private async resolvePublicAsset(parsed: Extract<ParsedDriveLink, { readonly linkType: "public_asset" }>): Promise<DriveLinkResolveDto> {
    const access = await this.deps.publicAssets.resolvePublicAsset(parsed.assetId, {})
    if (access.status !== "ok") throw new NotFoundException("公开素材不存在。")

    return {
      ok: true,
      linkType: "public_asset",
      access: { status: "ok", canRead: true, canList: false, canReadText: false, canDownload: true },
      root: { name: access.name, type: "asset", previewKind: previewKindFromMime(access.mimeType, access.name) },
      ref: { kind: "public_asset", shareId: null, itemId: null, siteId: null, path: null, assetId: parsed.assetId },
    }
  }

  private async readShareText(parsed: Extract<ParsedDriveLink, { readonly linkType: "share" }>, input: DriveLinkReadTextInput): Promise<DriveLinkReadTextDto> {
    const itemId = await this.resolveShareItemIdByPath(parsed, input)
    const snapshot = await this.deps.drive.getShareBrowserSnapshot({
      shareId: parsed.shareId,
      itemId,
      password: input.password,
      cookie: undefined,
    })
    const preview = snapshot.preview
    if (!preview || preview.kind === "download-only" || preview.text === null || preview.text === undefined) {
      throw new BadRequestException("该链接不是可读取的文本内容。")
    }
    const text = truncateUtf8(preview.text, input.maxBytes ?? DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES)
    return {
      path: snapshot.current.name,
      mimeType: snapshot.current.mimeType,
      previewKind: preview.kind,
      text: text.text,
      truncated: preview.truncated || text.truncated,
      source: { linkType: parsed.itemId ? "share_item" : "share" },
    }
  }

  private async readSiteText(parsed: Extract<ParsedDriveLink, { readonly linkType: "site" }>, input: DriveLinkReadTextInput): Promise<DriveLinkReadTextDto> {
    const access = await this.deps.sites.resolvePublicSite(parsed.siteId, { cookie: null, password: input.password, relativePath: input.path ?? parsed.path })
    if (access.status === "password_required") throw new BadRequestException("该链接需要密码。")
    if (access.status !== "ok") throw new NotFoundException("站点链接不存在。")

    const previewKind = previewKindFromMime(access.asset.contentType, access.asset.relativePath)
    if (previewKind === "download-only" || previewKind === "image") {
      throw new BadRequestException("该链接不是可读取的文本内容。")
    }
    const object = await this.deps.storage.getObjectStream({ key: access.asset.storageKey })
    const raw = await streamToString(object.stream, input.maxBytes ?? DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES)
    return {
      path: access.asset.relativePath,
      mimeType: object.contentType ?? access.asset.contentType ?? null,
      previewKind,
      text: raw.text,
      truncated: raw.truncated,
      source: { linkType: parsed.path ? "site_path" : "site" },
    }
  }

  private async resolveShareItemIdByPath(
    parsed: Extract<ParsedDriveLink, { readonly linkType: "share" }>,
    input: { readonly itemId?: string; readonly path?: string; readonly password?: string },
  ): Promise<string | undefined> {
    if (input.itemId) return input.itemId
    if (!input.path) return parsed.itemId ?? undefined
    const segments = parseSafeRelativePathSegments(input.path)
    let currentItemId = parsed.itemId ?? undefined
    for (const segment of segments) {
      let offset = 0
      let matched: DriveBrowserItemDto | undefined
      do {
        const snapshot = await this.deps.drive.getShareBrowserSnapshot({
          shareId: parsed.shareId,
          itemId: currentItemId,
          password: input.password,
          cookie: undefined,
          childrenPage: { offset, limit: 200 },
        })
        matched = snapshot.children.find((item) => item.name === segment)
        if (matched || !snapshot.childrenPage?.hasMore || snapshot.childrenPage.nextOffset === null) break
        offset = snapshot.childrenPage.nextOffset
      } while (!matched)
      if (!matched) throw new NotFoundException("分享文件不存在。")
      currentItemId = matched.id
    }
    return currentItemId
  }
}

function parseDriveLinkUrl(value: string): ParsedDriveLink {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BadRequestException("云盘链接无效。")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadRequestException("云盘链接无效。")

  const segments = url.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      throw new BadRequestException("云盘链接路径无效。")
    }
  })
  if (segments[0] === DRIVE_PUBLIC_PATH_PREFIX.slice(1) && segments[1]) {
    return { linkType: "share", shareId: segments[1], itemId: segments[2] === "items" ? segments[3] ?? null : null }
  }
  if (segments[0] === DRIVE_SITE_PATH_PREFIX.slice(1) && segments[1]) {
    return { linkType: "site", siteId: segments[1], path: segments.slice(2).join("/") }
  }
  if (segments[0] === DRIVE_PUBLIC_ASSET_PATH_PREFIX.slice(1) && segments[1] && segments.length === 2) {
    return { linkType: "public_asset", assetId: segments[1] }
  }
  throw new BadRequestException("仅支持 Synapse 云盘 /share、/sites 和 /files 链接。")
}

function toDriveLinkEntry(item: DriveBrowserItemDto): DriveLinkEntryDto {
  return {
    path: item.name,
    name: item.name,
    type: item.type,
    mimeType: item.mimeType,
    previewKind: item.previewKind,
    size: item.size,
    itemId: item.id,
  }
}

function toDriveLinkSiteEntry(item: { readonly relativePath: string; readonly contentType: string | null; readonly size: bigint }): DriveLinkEntryDto {
  return {
    path: item.relativePath,
    name: basenameFromRelativePath(item.relativePath),
    type: "file",
    mimeType: item.contentType,
    previewKind: previewKindFromMime(item.contentType, item.relativePath),
    size: item.size.toString(),
  }
}

function toShareRef(parsed: Extract<ParsedDriveLink, { readonly linkType: "share" }>): DriveLinkRefDto {
  return { kind: "share", shareId: parsed.shareId, itemId: parsed.itemId, siteId: null, path: null, assetId: null }
}

function toSiteRef(parsed: Extract<ParsedDriveLink, { readonly linkType: "site" }>): DriveLinkRefDto {
  return { kind: "site", shareId: null, itemId: null, siteId: parsed.siteId, path: parsed.path || null, assetId: null }
}

function passwordRequiredResolve(linkType: DriveLinkType, ref: DriveLinkRefDto): DriveLinkResolveDto {
  return {
    ok: true,
    linkType,
    access: { status: "password_required", canRead: false, canList: false, canReadText: false, canDownload: false },
    root: { name: protectedRootName(ref), type: "protected", previewKind: "download-only" },
    ref,
  }
}

function protectedRootName(ref: DriveLinkRefDto): string {
  return ref.kind === "site" ? "受密码保护的站点" : "受密码保护的分享"
}

function previewKindFromMime(mimeType: string | null | undefined, name: string): DriveLinkPreviewKind {
  const lowerName = name.toLowerCase()
  const lowerMime = mimeType?.toLowerCase() ?? ""
  if (lowerMime.startsWith("image/")) return "image"
  if (lowerMime === "text/markdown" || lowerName.endsWith(".md") || lowerName.endsWith(".markdown") || lowerName.endsWith(".mdx")) return "markdown"
  if (lowerMime === "text/html" || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) return "html-source"
  if (lowerMime.startsWith("text/") || lowerMime === "application/json" || lowerName.endsWith(".json")) return "text"
  return "download-only"
}

function basenameFromRelativePath(value: string): string {
  const segments = value.split("/").filter(Boolean)
  return segments.at(-1) ?? value
}

function parseSafeRelativePathSegments(value: string): string[] {
  if (value.includes("\\")) throw new BadRequestException("云盘链接路径无效。")
  const segments = value.split("/").filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new BadRequestException("云盘链接路径无效。")
  }
  return segments
}

function truncateUtf8(value: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const bytes = Buffer.byteLength(value)
  if (bytes <= maxBytes) return { text: value, truncated: false }
  return { text: Buffer.from(value).subarray(0, maxBytes).toString("utf8"), truncated: true }
}

async function streamToString(stream: NodeJS.ReadableStream, maxBytes: number): Promise<{ readonly text: string; readonly truncated: boolean }> {
  const chunks: Buffer[] = []
  let total = 0
  let truncated = false
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    const remaining = maxBytes - total
    if (remaining <= 0) {
      truncated = true
      break
    }
    if (buffer.byteLength > remaining) {
      chunks.push(buffer.subarray(0, remaining))
      total += remaining
      truncated = true
      break
    }
    chunks.push(buffer)
    total += buffer.byteLength
  }
  return { text: Buffer.concat(chunks, total).toString("utf8"), truncated }
}
