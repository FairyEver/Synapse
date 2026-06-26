import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common"
import {
  DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES,
  parseDrivePublicAssetUrl,
  type DriveDocumentImageImportRequest,
  type DriveDocumentImageImportResult,
  type DriveDocumentImageSource,
  type DriveDocumentImageSourcesDto,
} from "@synapse/shared"
import { extractDriveMarkdownImages } from "./drive-document-image-parser"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import { DriveRemoteImageFetcher } from "./drive-remote-image-fetcher"
import { DriveService } from "./drive.service"

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
}

@Injectable()
export class DriveDocumentImageService {
  private readonly drive: DriveDocumentImageDrivePort

  constructor(
    drive: DriveService,
    _publicAssets: DrivePublicAssetService,
    _fetcher: DriveRemoteImageFetcher,
  ) {
    this.drive = drive
  }

  async scanOwnerItemImages(input: { readonly actorUserId: string; readonly itemId: string }): Promise<DriveDocumentImageSourcesDto> {
    const document = await this.drive.getOwnerMarkdownImageDocument(input)
    return this.buildScanDto({ document, actorUserId: input.actorUserId })
  }

  async importOwnerItemImages(input: {
    readonly actorUserId: string
    readonly itemId: string
    readonly body: DriveDocumentImageImportRequest
  }): Promise<DriveDocumentImageImportResult> {
    if (input.body.sources.length > DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES) {
      throw new BadRequestException("单次转存图片过多。")
    }

    const document = await this.drive.getOwnerMarkdownImageDocument({
      actorUserId: input.actorUserId,
      itemId: input.itemId,
    })
    return this.importDocumentImages({ actorUserId: input.actorUserId, document, body: input.body })
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
    return this.importDocumentImages({ actorUserId: input.actorUserId, document, body: input.body })
  }

  private async buildScanDto(input: {
    readonly document: DriveMarkdownImageDocument
    readonly actorUserId: string
  }): Promise<DriveDocumentImageSourcesDto> {
    const sources: DriveDocumentImageSource[] = []
    for (const image of extractDriveMarkdownImages(input.document.markdown)) {
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

  private importDocumentImages(input: {
    readonly actorUserId: string
    readonly document: DriveMarkdownImageDocument
    readonly body: DriveDocumentImageImportRequest
  }): DriveDocumentImageImportResult {
    if (input.document.ownerId !== input.actorUserId) throw new ForbiddenException("只有所有者可以转存图片。")
    if (input.document.versionId !== input.body.baseVersionId) throw new BadRequestException("文档已更新。")

    return {
      itemId: input.document.itemId,
      versionId: input.document.versionId,
      imported: [],
      failed: input.body.sources.map((source) => ({
        src: source.src,
        reason: "unknown",
        message: "转存失败。",
      })),
      summary: {
        importedCount: 0,
        failedCount: input.body.sources.length,
        replacedOccurrenceCount: 0,
      },
    }
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
