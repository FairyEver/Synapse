import type { RendererLogger } from "./types"
import { guardedLog } from "./guard"

const SENSITIVE_PARAMS = new Set(["token", "key", "secret", "password", "auth", "api_key", "apikey", "access_token"])

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.username) url.username = "[REDACTED]"
    if (url.password) url.password = "[REDACTED]"
    for (const param of url.searchParams.keys()) {
      if (SENSITIVE_PARAMS.has(param.toLowerCase())) {
        url.searchParams.set(param, "[REDACTED]")
      }
    }
    return url.toString()
  } catch {
    return raw
  }
}

function extractMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (input instanceof Request) return input.method.toUpperCase()
  return "GET"
}

function extractUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  if (input instanceof Request) return input.url
  return String(input)
}

export function installNetworkInterceptor(logger: RendererLogger): () => void {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = extractUrl(input)

    if (url.startsWith("file://")) {
      return originalFetch(input, init)
    }

    const method = extractMethod(input, init)
    const start = performance.now()

    try {
      const response = await originalFetch(input, init)
      if (!response.ok) {
        const elapsed = Math.round(performance.now() - start)
        const safeUrl = sanitizeUrl(response.url || url)
        guardedLog(logger, "warn", `请求失败 ${method} → ${response.status} (${elapsed}ms)`, {
          url: safeUrl,
          status: response.status,
          elapsed,
        })
      }
      return response
    } catch (error) {
      const elapsed = Math.round(performance.now() - start)
      const safeUrl = sanitizeUrl(url)
      const message = error instanceof Error ? error.message : String(error)
      guardedLog(logger, "error", `网络错误 ${method} ${message}`, {
        url: safeUrl,
        error: message,
        elapsed,
      })
      throw error
    }
  }

  return () => {
    globalThis.fetch = originalFetch
  }
}
