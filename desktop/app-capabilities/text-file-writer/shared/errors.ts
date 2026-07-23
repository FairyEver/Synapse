export const TEXT_FILE_WRITE_ERROR_CODES = [
  "INVALID_PATH",
  "UNSUPPORTED_EXTENSION",
  "INVALID_ENCODING",
  "TARGET_EXISTS",
  "UNSAFE_TARGET",
  "TARGET_CHANGED",
  "PERMISSION_DENIED",
  "ABORTED",
  "WRITE_FAILED",
] as const

export type TextFileWriteErrorCode = typeof TEXT_FILE_WRITE_ERROR_CODES[number]

const ERROR_MESSAGES: Record<TextFileWriteErrorCode, string> = {
  INVALID_PATH: "文件路径必须是当前系统可识别的绝对路径。",
  UNSUPPORTED_EXTENSION: "当前仅支持 .txt、.md、.csv、.html 和 .htm 文件。",
  INVALID_ENCODING: "字符编码必须是 utf8 或 utf16le。",
  TARGET_EXISTS: "目标文件已存在，请启用覆盖后重试。",
  UNSAFE_TARGET: "目标路径必须指向普通文件，且不能是符号链接。",
  TARGET_CHANGED: "目标文件已发生变化，请重试。",
  PERMISSION_DENIED: "没有写入目标文件的权限。",
  ABORTED: "写入已取消。",
  WRITE_FAILED: "文本写入文件失败。",
}

export class TextFileWriteError extends Error {
  readonly retryable: boolean

  constructor(readonly code: TextFileWriteErrorCode, options?: ErrorOptions & { readonly message?: string }) {
    super(options?.message ?? ERROR_MESSAGES[code], options)
    this.name = "TextFileWriteError"
    this.retryable = code === "TARGET_CHANGED"
  }
}

export function isTextFileWriteError(error: unknown): error is TextFileWriteError {
  return error instanceof TextFileWriteError
}

export function normalizeTextFileWriteError(error: unknown): TextFileWriteError {
  if (isTextFileWriteError(error)) return error
  if (error instanceof DOMException && error.name === "AbortError") {
    return new TextFileWriteError("ABORTED", { cause: error })
  }
  if (hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM")) {
    return new TextFileWriteError("PERMISSION_DENIED", { cause: error })
  }
  if (hasErrorCode(error, "EINVAL") || hasErrorCode(error, "ENAMETOOLONG") || hasErrorCode(error, "ENOTDIR")) {
    return new TextFileWriteError("INVALID_PATH", { cause: error })
  }
  return new TextFileWriteError("WRITE_FAILED", { cause: error })
}

export function serializeTextFileWriteError(error: unknown): {
  readonly code: TextFileWriteErrorCode
  readonly message: string
  readonly retryable: boolean
} {
  const normalized = normalizeTextFileWriteError(error)
  return {
    code: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable,
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code
}
