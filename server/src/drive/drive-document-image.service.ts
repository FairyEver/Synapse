import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common"
import {
  DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES,
  parseDrivePublicAssetUrl,
  type DriveFileContentUpdateResult,
  type DriveFileTextUpdateInput,
  type DriveDocumentImageImportRequest,
  type DriveDocumentImageImportResult,
  type DriveDocumentImageSource,
  type DriveDocumentImageSourcesDto,
} from "@synapse/shared"
import { formatAuditError } from "../common/audit-error"
import { extractDriveMarkdownImages, normalizeDriveMarkdownImageSrc, replaceDriveMarkdownImageSources } from "./drive-document-image-parser"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import { DriveRemoteImageFetcher } from "./drive-remote-image-fetcher"
import { DriveService } from "./drive.service"

const DRIVE_DOCUMENT_IMAGE_SCAN_MAX_SOURCES = DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES

export interface DriveMarkdownImageDocument {
  readonly itemId: string
  readonly ownerId: string
  readonly versionId: string | null
  readonly markdown: string
}

export interface DriveDocumentImageDrivePort {
  getOwnerMarkdownImageDocument(input: {
    readonly actorUserId: string
    readonly itemId: string
  }): Promise<DriveMarkdownImageDocument>

  getShareMarkdownImageDocument(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string | null
    readonly cookie?: string
    readonly accessCookie?: string
  }): Promise<DriveMarkdownImageDocument>

  findPublicAssetOwner(assetId: string): Promise<string | null>

  updateOwnerFileText(
    userId: string,
    itemId: string,
    input: DriveFileTextUpdateInput,
    auditContext?: { readonly ipAddress?: string },
  ): Promise<DriveFileContentUpdateResult>
}

@Injectable()
export class DriveDocumentImageService {
  private readonly logger = new Logger(DriveDocumentImageService.name)
  private readonly drive: DriveDocumentImageDrivePort
  private readonly publicAssets: DrivePublicAssetService
  private readonly fetcher: DriveRemoteImageFetcher

  constructor(
    drive: DriveService,
    publicAssets: DrivePublicAssetService,
    fetcher: DriveRemoteImageFetcher,
  ) {
    this.drive = drive
    this.publicAssets = publicAssets
    this.fetcher = fetcher
  }

  async scanOwnerItemImages(input: { readonly actorUserId: string; readonly itemId: string }): Promise<DriveDocumentImageSourcesDto> {
    const document = await this.drive.getOwnerMarkdownImageDocument(input)
    return this.buildScanDto({ document, actorUserId: input.actorUserId })
  }

  async importOwnerItemImages(input: {
    readonly actorUserId: string
    readonly itemId: string
    readonly body: DriveDocumentImageImportRequest
    readonly publicAppUrl: string
    readonly auditContext?: { readonly ipAddress?: string }
  }): Promise<DriveDocumentImageImportResult> {
    if (input.body.sources.length > DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES) {
      throw new BadRequestException("单次转存图片过多。")
    }

    const document = await this.drive.getOwnerMarkdownImageDocument({
      actorUserId: input.actorUserId,
      itemId: input.itemId,
    })
    return this.importDocumentImages({
      actorUserId: input.actorUserId,
      document,
      body: input.body,
      publicAppUrl: input.publicAppUrl,
      auditContext: input.auditContext,
    })
  }

  async scanShareItemImages(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string | null
    readonly cookie?: string
  }): Promise<DriveDocumentImageSourcesDto> {
    const document = await this.drive.getShareMarkdownImageDocument(input)
    return this.buildScanDto({ document, actorUserId: input.actorUserId })
  }

  async importShareItemImages(input: {
    readonly actorUserId: string
    readonly shareId: string
    readonly itemId?: string | null
    readonly cookie?: string
    readonly body: DriveDocumentImageImportRequest
    readonly publicAppUrl: string
    readonly auditContext?: { readonly ipAddress?: string }
  }): Promise<DriveDocumentImageImportResult> {
    if (input.body.sources.length > DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES) {
      throw new BadRequestException("单次转存图片过多。")
    }

    const document = await this.drive.getShareMarkdownImageDocument({
      actorUserId: input.actorUserId,
      shareId: input.shareId,
      itemId: input.itemId,
      cookie: input.cookie,
    })
    return this.importDocumentImages({
      actorUserId: input.actorUserId,
      document,
      body: input.body,
      publicAppUrl: input.publicAppUrl,
      auditContext: input.auditContext,
    })
  }

  private async buildScanDto(input: {
    readonly document: DriveMarkdownImageDocument
    readonly actorUserId: string
  }): Promise<DriveDocumentImageSourcesDto> {
    const sources: DriveDocumentImageSource[] = []
    const images = extractDriveMarkdownImages(input.document.markdown)
      .slice(0, DRIVE_DOCUMENT_IMAGE_SCAN_MAX_SOURCES)
    for (const image of images) {
      sources.push(await this.classifySource({
        source: image,
        documentOwnerId: input.document.ownerId,
        actorUserId: input.actorUserId,
      }))
    }

    return {
      itemId: input.document.itemId,
      versionId: input.document.versionId,
      canImport: sources.some((source) => source.canImport),
      sources,
      summary: summarizeSources(sources),
    }
  }

  private async classifySource(input: {
    readonly source: Pick<DriveDocumentImageSource, "id" | "imageKey" | "src" | "occurrenceCount" | "altText">
    readonly documentOwnerId: string
    readonly actorUserId: string
  }): Promise<DriveDocumentImageSource> {
    const base = {
      id: input.source.id,
      imageKey: input.source.imageKey,
      src: input.source.src,
      occurrenceCount: input.source.occurrenceCount,
      ...(input.source.altText ? { altText: input.source.altText } : {}),
    }

    if (isDataImageSource(input.source.src)) {
      return {
        ...base,
        kind: "data",
        previewUrl: input.source.src,
        canImport: false,
        status: "ready",
        importDisabledReason: "unsupported",
      }
    }

    if (isRelativeImageSource(input.source.src)) {
      return {
        ...base,
        kind: "relative",
        canImport: false,
        status: "ready",
        importDisabledReason: "unsupported",
      }
    }

    const publicAsset = parseDrivePublicAssetUrl(input.source.src)
    if (publicAsset) {
      return this.classifyPublicAssetSource({
        ...input,
        assetId: publicAsset.assetId,
        base,
      })
    }

    if (isHttpImageSource(input.source.src)) {
      const canImport = input.actorUserId === input.documentOwnerId
      return {
        ...base,
        kind: "external",
        previewUrl: input.source.src,
        canImport,
        status: "ready",
        ...(canImport ? {} : { importDisabledReason: "not_owner" }),
      }
    }

    return {
      ...base,
      kind: "invalid",
      canImport: false,
      status: "unreachable",
      importDisabledReason: "unreachable",
    }
  }

  private async importDocumentImages(input: {
    readonly actorUserId: string
    readonly document: DriveMarkdownImageDocument
    readonly body: DriveDocumentImageImportRequest
    readonly publicAppUrl: string
    readonly auditContext?: { readonly ipAddress?: string }
  }): Promise<DriveDocumentImageImportResult> {
    if (input.document.ownerId !== input.actorUserId) throw new ForbiddenException("只有所有者可以转存图片。")
    if (input.document.versionId !== input.body.baseVersionId) throw new BadRequestException("文档已更新。")

    const scan = await this.buildScanDto({ document: input.document, actorUserId: input.actorUserId })
    const sourcesBySrc = new Map(scan.sources.map((source) => [normalizeDriveMarkdownImageSrc(source.src), source]))
    const replacements = new Map<string, string>()
    const imported: Array<DriveDocumentImageImportResult["imported"][number]> = []
    const failed: Array<DriveDocumentImageImportResult["failed"][number]> = []

    for (const requestedSource of input.body.sources) {
      const requestedSrc = normalizeDriveMarkdownImageSrc(requestedSource.src)
      const source = sourcesBySrc.get(requestedSrc)
      if (!source || !source.canImport) {
        failed.push({
          src: requestedSource.src,
          reason: source ? importFailureReasonForSource(source) : "changed",
          message: source ? importFailureMessageForSource(source) : "图片来源已变化。",
        })
        continue
      }

      try {
        const asset = await this.importSourceImage({
          actorUserId: input.actorUserId,
          publicAppUrl: input.publicAppUrl,
          source,
        })
        replacements.set(source.src, asset.url)
        imported.push({
          previousSrc: source.src,
          nextSrc: asset.url,
          assetId: asset.assetId,
          size: asset.size,
        })
      } catch (error) {
        failed.push({
          src: source.src,
          reason: importFailureReason(error),
          message: importFailureMessage(error),
        })
      }
    }

    let versionId = input.document.versionId
    let replacedOccurrenceCount = 0
    if (imported.length > 0) {
      try {
        const replaced = replaceDriveMarkdownImageSources(input.document.markdown, replacements)
        replacedOccurrenceCount = replaced.replacedOccurrenceCount
        if (replacedOccurrenceCount > 0) {
          const saved = await this.drive.updateOwnerFileText(input.actorUserId, input.document.itemId, {
            contentType: "text",
            text: replaced.markdown,
            baseVersionId: input.body.baseVersionId,
          }, input.auditContext)
          versionId = saved.version.id
        }
      } catch (error) {
        await this.cleanupImportedDocumentImageAssetsSafely({
          actorUserId: input.actorUserId,
          itemId: input.document.itemId,
          imported,
          auditContext: input.auditContext,
          cause: error,
        })
        throw error
      }
    }

    return {
      itemId: input.document.itemId,
      versionId: versionId ?? input.body.baseVersionId,
      imported,
      failed,
      summary: {
        importedCount: imported.length,
        failedCount: failed.length,
        replacedOccurrenceCount,
      },
    }
  }

  private async cleanupImportedDocumentImageAssetsSafely(input: {
    readonly actorUserId: string
    readonly itemId: string
    readonly imported: readonly DriveDocumentImageImportResult["imported"][number][]
    readonly auditContext?: { readonly ipAddress?: string }
    readonly cause: unknown
  }): Promise<void> {
    let failedCleanupCount = 0
    for (const asset of input.imported) {
      try {
        await this.publicAssets.cleanupImportedAsset(input.actorUserId, asset.assetId, input.auditContext)
      } catch (error) {
        failedCleanupCount += 1
        this.logger.warn({
          itemId: input.itemId,
          assetId: asset.assetId,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: formatAuditError(error),
        }, "Failed to cleanup imported document image asset")
      }
    }
    this.logger.warn({
      itemId: input.itemId,
      importedAssetCount: input.imported.length,
      failedCleanupCount,
      errorName: input.cause instanceof Error ? input.cause.name : typeof input.cause,
      errorMessage: formatAuditError(input.cause),
    }, "Drive document image import save failed after public assets were created")
  }

  private async importSourceImage(input: {
    readonly actorUserId: string
    readonly publicAppUrl: string
    readonly source: DriveDocumentImageSource
  }) {
    if (input.source.kind === "collaborator_asset" && input.source.assetId) {
      return this.publicAssets.copyPublicAssetToUser(input.actorUserId, input.source.assetId, input.publicAppUrl)
    }
    if (input.source.kind === "external") {
      const fetched = await this.fetcher.fetchImage(input.source.src)
      return this.publicAssets.importImageBuffer(input.actorUserId, input.publicAppUrl, {
        name: importedImageName(input.source.src, fetched.mimeType),
        mimeType: fetched.mimeType,
        body: fetched.body,
      })
    }
    throw new BadRequestException("图片无法转存。")
  }

  private async classifyPublicAssetSource(input: {
    readonly source: Pick<DriveDocumentImageSource, "src">
    readonly documentOwnerId: string
    readonly actorUserId: string
    readonly assetId: string
    readonly base: Pick<DriveDocumentImageSource, "id" | "imageKey" | "src" | "occurrenceCount" | "altText">
  }): Promise<DriveDocumentImageSource> {
    const assetOwnerId = await this.drive.findPublicAssetOwner(input.assetId)
    if (!assetOwnerId) {
      return {
        ...input.base,
        kind: "invalid",
        assetId: input.assetId,
        canImport: false,
        status: "unreachable",
        importDisabledReason: "unreachable",
      }
    }

    if (assetOwnerId === input.documentOwnerId) {
      return {
        ...input.base,
        kind: "owner_asset",
        previewUrl: input.source.src,
        assetId: input.assetId,
        assetOwnerId,
        canImport: false,
        status: "ready",
        importDisabledReason: "already_owned",
      }
    }

    const canImport = input.actorUserId === input.documentOwnerId
    return {
      ...input.base,
      kind: "collaborator_asset",
      previewUrl: input.source.src,
      assetId: input.assetId,
      assetOwnerId,
      canImport,
      status: "ready",
      ...(canImport ? {} : { importDisabledReason: "not_owner" }),
    }
  }
}

function summarizeSources(sources: readonly DriveDocumentImageSource[]): DriveDocumentImageSourcesDto["summary"] {
  return {
    total: sources.length,
    ownerAsset: sources.filter((source) => source.kind === "owner_asset").length,
    collaboratorAsset: sources.filter((source) => source.kind === "collaborator_asset").length,
    external: sources.filter((source) => source.kind === "external").length,
    invalid: sources.filter((source) => source.kind === "invalid").length,
    unsupported: sources.filter((source) => source.kind === "unsupported" || source.kind === "relative" || source.kind === "data").length,
    importable: sources.filter((source) => source.canImport).length,
  }
}

function isDataImageSource(src: string): boolean {
  return src.trimStart().toLowerCase().startsWith("data:")
}

function isRelativeImageSource(src: string): boolean {
  const trimmed = src.trimStart()
  return trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("/")
}

function isHttpImageSource(src: string): boolean {
  try {
    const url = new URL(src)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function importFailureReason(error: unknown): DriveDocumentImageImportResult["failed"][number]["reason"] {
  const message = error instanceof Error ? error.message : ""
  if (message.includes("格式不支持") || message.includes("仅支持图片") || message.includes("文件类型与扩展名不匹配")) return "unsupported"
  if (message.includes("图片过大") || message.includes("文件超过")) return "too_large"
  if (message.includes("云盘空间不足")) return "quota"
  if (message.includes("文档已更新") || message.includes("文件已有新内容")) return "changed"
  if (message.includes("无法转存") || message.includes("不存在")) return "unreachable"
  return "unknown"
}

function importFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return "转存失败。"
}

function importFailureReasonForSource(source: DriveDocumentImageSource): DriveDocumentImageImportResult["failed"][number]["reason"] {
  if (source.importDisabledReason === "unsupported") return "unsupported"
  if (source.importDisabledReason === "unreachable") return "unreachable"
  return "changed"
}

function importFailureMessageForSource(source: DriveDocumentImageSource): string {
  if (source.importDisabledReason === "not_owner") return "只有所有者可以转存图片。"
  if (source.importDisabledReason === "already_owned") return "图片已属于当前文档所有者。"
  if (source.importDisabledReason === "unsupported") return "格式不支持。"
  if (source.importDisabledReason === "unreachable") return "图片无法转存。"
  return "图片来源已变化。"
}

function importedImageName(src: string, mimeType: string): string {
  const extension = extensionForImageMime(mimeType)
  try {
    const url = new URL(src)
    const lastSegment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "")
    const name = lastSegment.replace(/[\\/:*?"<>|]/gu, "-").trim()
    if (name) return `${stripImageExtension(name)}.${extension}`
  } catch {
    // Fall through to a stable default name.
  }
  return `imported-image.${extension}`
}

function stripImageExtension(name: string): string {
  return name.replace(/\.(?:png|jpe?g|gif|webp|avif|ico)$/iu, "") || "imported-image"
}

function extensionForImageMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/gif") return "gif"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/avif") return "avif"
  if (mimeType === "image/x-icon") return "ico"
  return "png"
}
