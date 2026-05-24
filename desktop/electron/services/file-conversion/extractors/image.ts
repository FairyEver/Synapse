import { parserError } from "../errors"
import { normalizeMarkdownTitle } from "../markdown"
import { createUnavailableLocalOcrEngine, localOcrResultMetadata } from "../ocr/local-ocr"
import type { LocalOcrEngine } from "../ocr/types"
import type { FileConversionFormat, FileConversionInput, FileConversionResult, FileExtractor } from "../types"

type ImageConversionFormat = Extract<FileConversionFormat, "png" | "jpg" | "jpeg" | "webp">

const IMAGE_MIME_TYPES: Record<ImageConversionFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
}

export interface ImageExtractorOptions {
  readonly localOcrEngine?: LocalOcrEngine
}

export class ImageExtractor implements FileExtractor {
  readonly formats = ["png", "jpg", "jpeg", "webp"] as const
  private readonly localOcrEngine: LocalOcrEngine

  constructor(options: ImageExtractorOptions = {}) {
    this.localOcrEngine = options.localOcrEngine ?? createUnavailableLocalOcrEngine()
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    const format = imageFormatFromPath(input.filePath)
    try {
      const mimeType = IMAGE_MIME_TYPES[format]
      const result = await this.localOcrEngine.recognize({ filePath: input.filePath, mimeType })
      const text = result.text.trim()
      const title = normalizeMarkdownTitle(undefined, input.filePath)
      return {
        sourcePath: input.filePath,
        format,
        kind: "image",
        title,
        markdown: [`# ${title}`, "", text, ""].join("\n"),
        text,
        metadata: {
          mimeType,
          ocr: localOcrResultMetadata(result),
        },
        warnings: result.warnings ?? [],
      }
    } catch (error) {
      throw parserError("image OCR", error)
    }
  }
}

function imageFormatFromPath(filePath: string): ImageConversionFormat {
  const extension = filePath.split(".").pop()?.toLowerCase()
  if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp") {
    return extension
  }
  return "png"
}
