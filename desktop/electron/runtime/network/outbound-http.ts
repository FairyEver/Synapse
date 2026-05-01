export type OutboundHttpRequest = {
  readonly method: string
  readonly url: string
  readonly headers?: Record<string, string>
  readonly body?: string
  readonly timeoutMs?: number
  readonly abortSignal?: AbortSignal
  readonly fetchImpl?: typeof fetch
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
  request.abortSignal?.addEventListener("abort", onAbort, { once: true })
  try {
    const response = await (request.fetchImpl ?? fetch)(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    }
  } finally {
    if (timeout) clearTimeout(timeout)
    request.abortSignal?.removeEventListener("abort", onAbort)
  }
}
