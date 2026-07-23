export const HTML_GENERATION_ERROR_CODES = [
  "INVALID_TEMPLATE",
  "INVALID_DATA",
  "TEMPLATE_TOO_LARGE",
  "DATA_TOO_LARGE",
  "INPUT_TOO_LARGE",
  "TEMPLATE_COMPILE_FAILED",
  "OUTPUT_TOO_LARGE",
  "PERMISSION_DENIED",
  "RENDER_QUEUE_FULL",
  "RENDER_TIMEOUT",
  "RENDER_MEMORY_LIMIT",
  "RENDER_CANCELLED",
  "RENDER_FAILED",
] as const

export type HtmlGenerationErrorCode = typeof HTML_GENERATION_ERROR_CODES[number]

const HTML_GENERATION_ERROR_MESSAGES: Record<HtmlGenerationErrorCode, string> = {
  INVALID_TEMPLATE: "模板必须是至少 1 个字符的有效 Unicode 文本。",
  INVALID_DATA: "数据必须是可严格 JSON 序列化的顶层对象。",
  TEMPLATE_TOO_LARGE: "模板超过 256 KiB 限制。",
  DATA_TOO_LARGE: "数据超过 512 KiB 限制。",
  INPUT_TOO_LARGE: "模板与数据合计超过 768 KiB 限制。",
  TEMPLATE_COMPILE_FAILED: "EJS 模板编译失败。",
  OUTPUT_TOO_LARGE: "生成的 HTML 超过 5 MiB 限制。",
  PERMISSION_DENIED: "没有执行 EJS 模板的权限。",
  RENDER_QUEUE_FULL: "HTML 生成队列已满，请稍后重试。",
  RENDER_TIMEOUT: "EJS 模板渲染超过 5 秒限制。",
  RENDER_MEMORY_LIMIT: "EJS 模板渲染超过 Worker 内存限制。",
  RENDER_CANCELLED: "HTML 生成已取消。",
  RENDER_FAILED: "EJS 模板渲染失败。",
}

export type HtmlGenerationErrorPayload = {
  readonly code: HtmlGenerationErrorCode
  readonly message: string
  readonly retryable: boolean
  readonly line?: number
}

export class HtmlGenerationError extends Error {
  readonly retryable: boolean

  constructor(
    readonly code: HtmlGenerationErrorCode,
    options: { readonly cause?: unknown; readonly line?: number; readonly message?: string } = {},
  ) {
    super(options.message ?? HTML_GENERATION_ERROR_MESSAGES[code], { cause: options.cause })
    this.name = "HtmlGenerationError"
    this.retryable = code === "RENDER_QUEUE_FULL"
    this.line = options.line
  }

  readonly line?: number
}

export function isHtmlGenerationError(error: unknown): error is HtmlGenerationError {
  return error instanceof HtmlGenerationError
}

export function normalizeHtmlGenerationError(error: unknown): HtmlGenerationError {
  return isHtmlGenerationError(error) ? error : new HtmlGenerationError("RENDER_FAILED", { cause: error })
}

export function serializeHtmlGenerationError(error: unknown): HtmlGenerationErrorPayload {
  const normalized = normalizeHtmlGenerationError(error)
  return {
    code: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable,
    ...(normalized.line === undefined ? {} : { line: normalized.line }),
  }
}
