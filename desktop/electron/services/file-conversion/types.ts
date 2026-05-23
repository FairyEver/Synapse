export type FileConversionKind = "document" | "spreadsheet" | "pdf" | "presentation"

export type FileConversionFormat = "doc" | "docx" | "xlsx" | "pdf" | "ppt" | "pptx"

export interface FileConversionInput {
  readonly filePath: string
  readonly preferredOutput?: "markdown" | "text"
}

export interface FileConversionWarning {
  readonly code: string
  readonly message: string
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
