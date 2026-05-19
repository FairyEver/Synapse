export type OutboundHttpRequest = {
  readonly method: string
  readonly url: string
  readonly headers?: Record<string, string>
  readonly body?: string
  readonly timeoutMs?: number
  readonly abortSignal?: AbortSignal
  readonly fetchImpl?: typeof fetch
  readonly maxResponseBodyBytes?: number
  readonly logger?: {
    warn: (message: string, meta?: unknown) => void
    error: (message: string, meta?: unknown) => void
  }
}

export type OutboundHttpResponse = {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: string
}

export async function sendOutboundHttpRequest(
  request: OutboundHttpRequest,
): Promise<OutboundHttpResponse> {
  const controller = new AbortController()
  const timeout = request.timeoutMs === undefined
    ? undefined
    : setTimeout(() => controller.abort(), request.timeoutMs)
  const onAbort = () => controller.abort()
  if (request.abortSignal?.aborted) {
    controller.abort()
  } else {
    request.abortSignal?.addEventListener("abort", onAbort, { once: true })
  }
  const startedAt = performance.now()
  try {
    const response = await (request.fetchImpl ?? fetch)(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    const elapsedMs = Math.round(performance.now() - startedAt)
    if (!response.ok) {
      request.logger?.warn("Outbound HTTP request failed.", {
        method: request.method,
        url: sanitizeUrl(request.url),
        status: response.status,
        statusText: response.statusText,
        elapsedMs,
        requestHeaders: sanitizeHeaders(request.headers),
      })
    }
    const body = await readBodyWithLimit(response, request.maxResponseBodyBytes)
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  } catch (error) {
    request.logger?.error("Outbound HTTP request errored.", {
      method: request.method,
      url: sanitizeUrl(request.url),
      elapsedMs: Math.round(performance.now() - startedAt),
      error,
      requestHeaders: sanitizeHeaders(request.headers),
    })
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    request.abortSignal?.removeEventListener("abort", onAbort)
  }
}

const TRUNCATED_MESSAGE = "\n\n[响应体超过大小限制，已截断]"

async function readBodyWithLimit(response: Response, maxBytes?: number): Promise<string> {
  if (maxBytes === undefined || maxBytes <= 0) {
    return await response.text()
  }
  const reader = response.body?.getReader()
  if (!reader) {
    return (await response.text()).slice(0, maxBytes)
  }
  const decoder = new TextDecoder()
  let result = ""
  let totalRead = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalRead += value.length
    if (totalRead > maxBytes) {
      const remaining = maxBytes - (totalRead - value.length)
      if (remaining > 0) {
        result += decoder.decode(value.slice(0, remaining))
      }
      result += TRUNCATED_MESSAGE
      reader.cancel()
      break
    }
    result += decoder.decode(value, { stream: true })
  }
  return result + decoder.decode()
}

const SENSITIVE_PARAM_NAMES = new Set(["token", "key", "secret", "password", "auth", "api_key", "apikey", "access_token"])
const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.username) url.username = "[REDACTED]"
    if (url.password) url.password = "[REDACTED]"
    for (const param of url.searchParams.keys()) {
      if (SENSITIVE_PARAM_NAMES.has(param.toLowerCase())) {
        url.searchParams.set(param, "[REDACTED]")
      }
    }
    return url.toString()
  } catch {
    return raw
  }
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADER_PATTERN.test(key) ? "[redacted]" : value,
    ]),
  )
}
