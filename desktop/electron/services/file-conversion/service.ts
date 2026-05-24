import { lstat } from "node:fs/promises"

import { normalizeMarkdownTitle } from "./markdown"
import { createUnavailableLocalOcrEngine, localOcrResultMetadata } from "./ocr/local-ocr"
import type { LocalOcrEngine } from "./ocr/types"
import { detectConversionFormat, FileExtractorRegistry } from "./registry"
import {
  FileConversionError,
  type FileConversionFormat,
  type FileConversionInput,
  type FileConversionResult,
  type FileExtractor,
} from "./types"

export interface FileConversionServiceOptions {
  readonly extractors: readonly FileExtractor[]
  readonly maxBytes?: number
  readonly localOcrEngine?: LocalOcrEngine
}

export class FileConversionService {
  private readonly registry: FileExtractorRegistry
  private readonly maxBytes: number
  private readonly localOcrEngine: LocalOcrEngine

  constructor(options: FileConversionServiceOptions) {
    this.registry = new FileExtractorRegistry(options.extractors)
    this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024
    this.localOcrEngine = options.localOcrEngine ?? createUnavailableLocalOcrEngine()
  }

  async convert(input: FileConversionInput): Promise<FileConversionResult> {
    const format = detectConversionFormat(input.filePath)
    const stat = await lstat(input.filePath).catch((error: unknown) => {
      throw new FileConversionError("read_failed", "Could not read source file.", { cause: error })
    })
    if (!stat.isFile()) {
      throw new FileConversionError("read_failed", "Source path is not a file.")
    }
    if (stat.size > this.maxBytes) {
      throw new FileConversionError("size_limit_exceeded", "Source file exceeds the conversion size limit.")
    }
    if (isImageFormat(format)) {
      return this.extractImage(input, format)
    }
    return this.registry.get(format).extract(input)
  }

  private async extractImage(input: FileConversionInput, format: ImageConversionFormat): Promise<FileConversionResult> {
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
  }
}

type ImageConversionFormat = Extract<FileConversionFormat, "png" | "jpg" | "jpeg" | "webp">

const IMAGE_MIME_TYPES: Record<ImageConversionFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
}

function isImageFormat(format: FileConversionFormat): format is ImageConversionFormat {
  return format === "png" || format === "jpg" || format === "jpeg" || format === "webp"
}
