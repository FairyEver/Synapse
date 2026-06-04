export type FileConversionKind = "document" | "spreadsheet" | "pdf" | "presentation" | "image"

export type FileConversionFormat = "doc" | "docx" | "xlsx" | "pdf" | "ppt" | "pptx" | "png" | "jpg" | "jpeg" | "webp"

export interface FileConversionOcrOptions {
  readonly enabled: boolean
  readonly languages?: readonly string[]
  readonly maxPages?: number
}

export interface FileConversionInput {
  readonly filePath: string
  readonly preferredOutput?: "markdown" | "text"
  readonly ocr?: FileConversionOcrOptions
  readonly imageHandling?: FileConversionImageHandling
}

export type FileConversionImageHandling =
  | { readonly mode: "omit" }
  | { readonly mode: "assets"; readonly assetDirectoryName: string }

export interface FileConversionWarning {
  readonly code: string
  readonly message: string
}

export interface FileConversionAsset {
  readonly relativePath: string
  readonly fileName: string
  readonly mimeType: string
  readonly content: Buffer
}

export interface FileConversionResult {
  readonly sourcePath: string
  readonly format: FileConversionFormat
  readonly kind: FileConversionKind
  readonly title: string
  readonly markdown: string
  readonly text: string
  readonly metadata: Record<string, unknown>
  readonly warnings: readonly FileConversionWarning[]
  readonly assets?: readonly FileConversionAsset[]
}

export type FileConversionErrorCode =
  | "unsupported_format"
  | "encrypted"
  | "missing_local_helper"
  | "parse_failed"
  | "read_failed"
  | "size_limit_exceeded"

export class FileConversionError extends Error {
  readonly code: FileConversionErrorCode

  constructor(code: FileConversionErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message)
    this.name = "FileConversionError"
    this.code = code
    if (options && "cause" in options) {
      this.cause = options.cause
    }
  }
}

export interface FileExtractor {
  readonly formats: readonly FileConversionFormat[]
  extract(input: FileConversionInput): Promise<FileConversionResult>
}
