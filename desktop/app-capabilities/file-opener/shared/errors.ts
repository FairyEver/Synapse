export const FILE_OPENER_ERROR_CODES = [
  "invalid_path",
  "file_not_found_or_inaccessible",
  "symbolic_link_not_supported",
  "not_regular_file",
  "permission_denied",
  "system_rejected",
  "open_failed",
] as const

export type FileOpenerErrorCode = (typeof FILE_OPENER_ERROR_CODES)[number]

const ERROR_MESSAGES: Record<FileOpenerErrorCode, string> = {
  invalid_path: "文件路径无效",
  file_not_found_or_inaccessible: "文件不存在或无法访问",
  symbolic_link_not_supported: "不支持符号链接",
  not_regular_file: "文件路径必须指向普通文件",
  permission_denied: "没有打开该文件的权限",
  system_rejected: "系统未接受打开请求",
  open_failed: "打开文件失败",
}

export class FileOpenerError extends Error {
  constructor(readonly code: FileOpenerErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = "FileOpenerError"
  }
}

export function normalizeFileOpenerError(error: unknown): FileOpenerError {
  return error instanceof FileOpenerError ? error : new FileOpenerError("open_failed")
}

export function serializeFileOpenerError(error: unknown): { code: FileOpenerErrorCode; message: string } {
  const normalized = normalizeFileOpenerError(error)
  return { code: normalized.code, message: normalized.message }
}

