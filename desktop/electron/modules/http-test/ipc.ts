import { handleValidatedIpc } from "../../ipc/validated-ipc"
import { sendOutboundHttpRequest } from "../../runtime/network"
import type { HttpRequestActionConfig } from "../../../action-packages/builtin/http-request/schema"

export const HTTP_TEST_CHANNEL = "synapse:http:test-request"

export interface HttpTestResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: string
  readonly durationMs: number
}

function buildUrl(config: HttpRequestActionConfig): string {
  const url = new URL(config.url)
  if (config.query) {
    for (const [key, value] of Object.entries(config.query)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

function buildBody(config: HttpRequestActionConfig): string | undefined {
  if (config.bodyType === "none") return undefined
  return config.body
}

function buildHeaders(config: HttpRequestActionConfig): Record<string, string> | undefined {
  const headers = config.headers ? { ...config.headers } : {} as Record<string, string>

  if (config.auth?.type === "bearer" && config.auth.bearerToken) {
    headers["Authorization"] = `Bearer ${config.auth.bearerToken}`
  } else if (config.auth?.type === "basic" && config.auth.basicUsername) {
    const encoded = Buffer.from(`${config.auth.basicUsername}:${config.auth.basicPassword ?? ""}`).toString("base64")
    headers["Authorization"] = `Basic ${encoded}`
  }

  return Object.keys(headers).length > 0 ? headers : undefined
}

let handlersRegistered = false

export function registerHttpTestHandlers(): void {
  if (handlersRegistered) return

  handleValidatedIpc(HTTP_TEST_CHANNEL, async (_event, config: HttpRequestActionConfig): Promise<HttpTestResponse> => {
    const startedAt = performance.now()
    const response = await sendOutboundHttpRequest({
      method: config.method,
      url: buildUrl(config),
      headers: buildHeaders(config),
      body: buildBody(config),
      timeoutMs: config.timeoutMins === null ? undefined : (config.timeoutMins ?? 5) * 60_000,
    })
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers ?? {},
      body: response.body ?? "",
      durationMs: Math.round(performance.now() - startedAt),
    }
  })

  handlersRegistered = true
}
