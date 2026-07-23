import type { JsonObject } from "../shared/schema"

export type HtmlGenerationWorkerInput = {
  readonly template: string
  readonly data: JsonObject
}

export type HtmlGenerationWorkerMessage =
  | { readonly type: "started" }
  | { readonly type: "success"; readonly html: string; readonly size: number }
  | {
      readonly type: "error"
      readonly code: "TEMPLATE_COMPILE_FAILED" | "OUTPUT_TOO_LARGE" | "RENDER_FAILED"
      readonly line?: number
    }

export function parseHtmlGenerationWorkerMessage(value: unknown): HtmlGenerationWorkerMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null
  if (value.type === "started") {
    return hasExactKeys(value, ["type"]) ? { type: "started" } : null
  }
  if (value.type === "success") {
    if (!hasExactKeys(value, ["type", "html", "size"])) return null
    return typeof value.html === "string" && Number.isSafeInteger(value.size) && Number(value.size) >= 0
      ? { type: "success", html: value.html, size: Number(value.size) }
      : null
  }
  if (value.type === "error") {
    if (!hasExactKeys(value, value.line === undefined ? ["type", "code"] : ["type", "code", "line"])) return null
    if (!["TEMPLATE_COMPILE_FAILED", "OUTPUT_TOO_LARGE", "RENDER_FAILED"].includes(String(value.code))) return null
    if (value.line !== undefined && (!Number.isSafeInteger(value.line) || Number(value.line) <= 0)) return null
    return {
      type: "error",
      code: value.code as "TEMPLATE_COMPILE_FAILED" | "OUTPUT_TOO_LARGE" | "RENDER_FAILED",
      ...(value.line === undefined ? {} : { line: Number(value.line) }),
    }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}
