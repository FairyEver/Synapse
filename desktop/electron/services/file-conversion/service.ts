import { lstat } from "node:fs/promises"

import { detectConversionFormat, FileExtractorRegistry } from "./registry"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "./types"

export const DEFAULT_FILE_CONVERSION_MAX_BYTES = 50 * 1024 * 1024

export interface FileConversionServiceOptions {
  readonly extractors: readonly FileExtractor[]
  readonly maxBytes?: number
}

export class FileConversionService {
  private readonly registry: FileExtractorRegistry
  private readonly maxBytes: number

  constructor(options: FileConversionServiceOptions) {
    this.registry = new FileExtractorRegistry(options.extractors)
    this.maxBytes = options.maxBytes ?? DEFAULT_FILE_CONVERSION_MAX_BYTES
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
    return this.registry.get(format).extract(input)
  }
}
