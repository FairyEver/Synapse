import { createRequire } from "node:module"
import path from "node:path"

import { parserError } from "../errors"
import { htmlToMarkdown } from "../html-to-markdown"
import { normalizeMarkdownTitle } from "../markdown"
import {
  type FileConversionAsset,
  type FileConversionImageHandling,
  type FileConversionInput,
  type FileConversionResult,
  type FileConversionWarning,
  type FileExtractor,
} from "../types"

const requireFromHere = createRequire(__filename)

type MammothMessage = {
  readonly type: string
  readonly message: string
}

type MammothHtmlResult = {
  readonly value: string
  readonly messages: readonly MammothMessage[]
}

type MammothImage = {
  readonly contentType: string
  readAsBase64String(): Promise<string>
}

type MammothImageAttributes = {
  readonly src?: string
}

type MammothImageConverter = unknown
type MammothImageConversionResult = MammothImageAttributes | readonly []

type MammothImages = {
  imgElement(convertImage: (image: MammothImage) => Promise<MammothImageConversionResult>): MammothImageConverter
}

type MammothConvertOptions = {
  readonly convertImage?: MammothImageConverter
}

type ConvertToHtml = (
  input: { readonly path: string },
  options?: MammothConvertOptions,
) => Promise<MammothHtmlResult>

type MammothModule = {
  readonly convertToHtml: ConvertToHtml
  readonly images: MammothImages
}

type DocxImageAssetLimits = {
  readonly maxCount: number
  readonly maxBytes: number
  readonly maxTotalBytes: number
}

const DEFAULT_DOCX_IMAGE_ASSET_LIMITS: DocxImageAssetLimits = {
  maxCount: 100,
  maxBytes: 10 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
}

export interface DocxExtractorOptions {
  readonly convertToHtml?: ConvertToHtml
  readonly images?: MammothImages
  readonly imageAssetLimits?: Partial<DocxImageAssetLimits>
}

export class DocxExtractor implements FileExtractor {
  readonly formats = ["docx"] as const
  private readonly convertToHtml: ConvertToHtml
  private readonly images: MammothImages
  private readonly imageAssetLimits: DocxImageAssetLimits

  constructor(options: DocxExtractorOptions = {}) {
    const mammoth = requireFromHere("mammoth") as MammothModule
    this.convertToHtml = options.convertToHtml ?? mammoth.convertToHtml
    this.images = options.images ?? mammoth.images
    this.imageAssetLimits = { ...DEFAULT_DOCX_IMAGE_ASSET_LIMITS, ...options.imageAssetLimits }
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const imageState = this.createImageConversion(input.imageHandling)
      const extracted = await this.convertToHtml({ path: input.filePath }, {
        convertImage: imageState.convertImage,
      })
      const markdownBody = htmlToMarkdown(extracted.value)
      const title = extractFirstMarkdownHeading(markdownBody) ?? normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
      const markdown = markdownBody.startsWith("# ")
        ? `${markdownBody}\n`
        : [`# ${title}`, "", markdownBody, ""].join("\n")
      const text = markdownBody.replace(/^#{1,6}\s+/gm, "").replace(/\|/g, " ").trim()
      const warnings = imageState.omittedCount > 0
        ? [
            ...extracted.messages.map(toWarning),
            {
              code: "docx_inline_images_omitted",
              message: "DOCX inline images were omitted from the Markdown output.",
            },
          ]
        : extracted.messages.map(toWarning)
      return {
        sourcePath: input.filePath,
        format: "docx",
        kind: "document",
        title,
        markdown,
        text,
        metadata: { messages: extracted.messages },
        warnings,
        assets: imageState.assets,
      }
    } catch (error) {
      throw parserError("DOCX", error)
    }
  }

  private createImageConversion(imageHandling: FileConversionImageHandling | undefined): {
    readonly convertImage: MammothImageConverter
    readonly assets: FileConversionAsset[]
    omittedCount: number
  } {
    const assets: FileConversionAsset[] = []
    const mode = imageHandling ?? { mode: "omit" }
    if (mode.mode === "omit") {
      const state = {
        convertImage: async () => {
          state.omittedCount += 1
          return []
        },
        assets,
        omittedCount: 0,
      }
      return state
    }

    const state = {
      assets,
      omittedCount: 0,
      seenImageCount: 0,
      totalAssetBytes: 0,
      convertImage: this.images.imgElement(async (image) => {
        state.seenImageCount += 1
        if (state.seenImageCount > this.imageAssetLimits.maxCount) {
          state.omittedCount += 1
          return []
        }
        const index = assets.length + 1
        const extension = extensionForMimeType(image.contentType)
        const fileName = `image-${index}${extension}`
        const relativePath = `${normalizeAssetDirectoryName(mode.assetDirectoryName)}/${fileName}`
        const base64 = await image.readAsBase64String()
        const estimatedBytes = decodedBase64ByteLength(base64)
        if (
          estimatedBytes > this.imageAssetLimits.maxBytes
          || state.totalAssetBytes + estimatedBytes > this.imageAssetLimits.maxTotalBytes
        ) {
          state.omittedCount += 1
          return []
        }
        const content = Buffer.from(base64, "base64")
        if (
          content.byteLength > this.imageAssetLimits.maxBytes
          || state.totalAssetBytes + content.byteLength > this.imageAssetLimits.maxTotalBytes
        ) {
          state.omittedCount += 1
          return []
        }
        state.totalAssetBytes += content.byteLength
        assets.push({
          relativePath,
          fileName,
          mimeType: image.contentType,
          content,
        })
        return { src: `./${relativePath}` }
      }),
    }
    return state
  }
}

function extractFirstMarkdownHeading(markdown: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdown)
  return match?.[1]?.trim() || null
}

function toWarning(message: MammothMessage): FileConversionWarning {
  return {
    code: message.type,
    message: message.message,
  }
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpeg"
    case "image/png":
      return ".png"
    case "image/webp":
      return ".webp"
    case "image/gif":
      return ".gif"
    default:
      return ".bin"
  }
}

function normalizeAssetDirectoryName(directoryName: string): string {
  return directoryName.replace(/\\/g, "/").replace(/^\.\/+/, "")
}

function decodedBase64ByteLength(value: string): number {
  const normalized = value.replace(/\s/g, "")
  if (!normalized) return 0
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}
