export const DOCUMENT_TEXT_EXTRACTION_ERROR_CODES = [
  "UNSUPPORTED_FORMAT",
  "INVALID_DOCUMENT",
  "PASSWORD_PROTECTED",
  "FILE_TOO_LARGE",
  "TEXT_TOO_LARGE",
  "PDF_PAGE_LIMIT_EXCEEDED",
  "READ_FAILED",
  "PERMISSION_DENIED",
  "EXTRACTION_TIMEOUT",
  "EXTRACTION_MEMORY_LIMIT",
  "EXTRACTION_CANCELLED",
  "EXTRACTION_FAILED",
] as const

export type DocumentTextExtractionErrorCode =
  typeof DOCUMENT_TEXT_EXTRACTION_ERROR_CODES[number]

const ERROR_MESSAGES: Record<DocumentTextExtractionErrorCode, string> = {
  UNSUPPORTED_FORMAT: "当前仅支持 PDF 或 DOCX 文档。",
  INVALID_DOCUMENT: "文档格式无效或文件已损坏。",
  PASSWORD_PROTECTED: "文档受密码保护，无法提取文本。",
  FILE_TOO_LARGE: "文档超过 50 MiB 限制。",
  TEXT_TOO_LARGE: "提取文本超过 5 MiB 限制。",
  PDF_PAGE_LIMIT_EXCEEDED: "PDF 超过 2,000 页限制。",
  READ_FAILED: "无法安全读取文档。",
  PERMISSION_DENIED: "没有读取所选文档的权限。",
  EXTRACTION_TIMEOUT: "文档文本提取超时。",
  EXTRACTION_MEMORY_LIMIT: "文档文本提取超过内存限制。",
  EXTRACTION_CANCELLED: "文档文本提取已取消。",
  EXTRACTION_FAILED: "文档文本提取失败。",
}

export class DocumentTextExtractionError extends Error {
  readonly code: DocumentTextExtractionErrorCode

  constructor(code: DocumentTextExtractionErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options)
    this.name = "DocumentTextExtractionError"
    this.code = code
  }
}

export function isDocumentTextExtractionError(
  error: unknown,
): error is DocumentTextExtractionError {
  return error instanceof DocumentTextExtractionError
}

export const DOCUMENT_TEXT_SAVE_ERROR_CODES = [
  "INVALID_OUTPUT",
  "UNSAFE_OUTPUT_TARGET",
  "OUTPUT_CHANGED",
  "PERMISSION_DENIED",
  "WRITE_FAILED",
] as const

export type DocumentTextSaveErrorCode =
  typeof DOCUMENT_TEXT_SAVE_ERROR_CODES[number]

const SAVE_ERROR_MESSAGES: Record<DocumentTextSaveErrorCode, string> = {
  INVALID_OUTPUT: "输出文件必须是 .txt 文件。",
  UNSAFE_OUTPUT_TARGET: "无法安全写入所选文件。",
  OUTPUT_CHANGED: "输出文件在写入前发生变化。",
  PERMISSION_DENIED: "没有写入所选文件的权限。",
  WRITE_FAILED: "保存文本失败。",
}

export class DocumentTextSaveError extends Error {
  readonly code: DocumentTextSaveErrorCode

  constructor(code: DocumentTextSaveErrorCode, options?: ErrorOptions) {
    super(SAVE_ERROR_MESSAGES[code], options)
    this.name = "DocumentTextSaveError"
    this.code = code
  }
}

export function isDocumentTextSaveError(error: unknown): error is DocumentTextSaveError {
  return error instanceof DocumentTextSaveError
}
