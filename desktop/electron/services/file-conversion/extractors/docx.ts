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
  readonly src: string
}

type MammothImageConverter = unknown

type MammothImages = {
  imgElement(convertImage: (image: MammothImage) => Promise<MammothImageAttributes>): MammothImageConverter
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

export interface DocxExtractorOptions {
  readonly convertToHtml?: ConvertToHtml
  readonly images?: MammothImages
}

export class DocxExtractor implements FileExtractor {
  readonly formats = ["docx"] as const
  private readonly convertToHtml: ConvertToHtml
  private readonly images: MammothImages

  constructor(options: DocxExtractorOptions = {}) {
    const mammoth = requireFromHere("mammoth") as MammothModule
    this.convertToHtml = options.convertToHtml ?? mammoth.convertToHtml
    this.images = options.images ?? mammoth.images
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
      convertImage: this.images.imgElement(async (image) => {
        const index = assets.length + 1
        const extension = extensionForMimeType(image.contentType)
        const fileName = `image-${index}${extension}`
        const relativePath = `${normalizeAssetDirectoryName(mode.assetDirectoryName)}/${fileName}`
        const content = Buffer.from(await image.readAsBase64String(), "base64")
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
