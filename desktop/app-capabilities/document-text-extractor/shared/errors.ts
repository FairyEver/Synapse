export const DOCUMENT_TEXT_EXTRACTION_ERROR_CODES = [
  "UNSUPPORTED_FORMAT",
  "INVALID_DOCUMENT",
  "PASSWORD_PROTECTED",
  "FILE_TOO_LARGE",
  "TEXT_TOO_LARGE",
  "PDF_PAGE_LIMIT_EXCEEDED",
  "READ_FAILED",
  "EXTRACTION_TIMEOUT",
  "EXTRACTION_MEMORY_LIMIT",
  "EXTRACTION_CANCELLED",
  "EXTRACTION_FAILED",
] as const

export type DocumentTextExtractionErrorCode =
  typeof DOCUMENT_TEXT_EXTRACTION_ERROR_CODES[number]

const ERROR_MESSAGES: Record<DocumentTextExtractionErrorCode, string> = {
  UNSUPPORTED_FORMAT: "当前仅支持 PDF 文档。",
  INVALID_DOCUMENT: "文档格式无效或文件已损坏。",
  PASSWORD_PROTECTED: "文档受密码保护，无法提取文本。",
  FILE_TOO_LARGE: "文档超过 50 MiB 限制。",
  TEXT_TOO_LARGE: "提取文本超过 5 MiB 限制。",
  PDF_PAGE_LIMIT_EXCEEDED: "PDF 超过 2,000 页限制。",
  READ_FAILED: "无法安全读取文档。",
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
