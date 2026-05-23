import path from "node:path"

import { FileConversionError, type FileConversionFormat, type FileExtractor } from "./types"

const EXTENSION_FORMATS = new Map<string, FileConversionFormat>([
  [".doc", "doc"],
  [".docx", "docx"],
  [".xlsx", "xlsx"],
  [".pdf", "pdf"],
  [".ppt", "ppt"],
  [".pptx", "pptx"],
])

export function detectConversionFormat(filePath: string): FileConversionFormat {
  const format = EXTENSION_FORMATS.get(path.extname(filePath).toLowerCase())
  if (!format) {
    throw new FileConversionError("unsupported_format", `Unsupported file format: ${path.extname(filePath) || "unknown"}`)
  }
  return format
}

export class FileExtractorRegistry {
  private readonly byFormat = new Map<FileConversionFormat, FileExtractor>()

  constructor(extractors: readonly FileExtractor[]) {
    for (const extractor of extractors) {
      for (const format of extractor.formats) {
        this.byFormat.set(format, extractor)
      }
    }
  }

  get(format: FileConversionFormat): FileExtractor {
    const extractor = this.byFormat.get(format)
    if (!extractor) {
      throw new FileConversionError("missing_local_helper", `No extractor is available for ${format}.`)
    }
    return extractor
  }
}
