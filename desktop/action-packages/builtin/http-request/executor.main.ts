import type {
  OutboundHttpRequest,
  OutboundHttpResponse,
} from "../../../electron/runtime/network"
import { sendOutboundHttpRequest } from "../../../electron/runtime/network"
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { httpRequestActionManifest } from "./manifest"
import type { HttpRequestActionConfig } from "./schema"

function sanitizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr)
    for (const [key] of url.searchParams) {
      if (/token|secret|authorization|api[_-]?key|password|bearer|auth/i.test(key)) {
        url.searchParams.set(key, "[redacted]")
      }
    }
    return url.toString()
  } catch {
    return urlStr
  }
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

export function createHttpRequestAction(deps: {
  readonly sendRequest?: (request: OutboundHttpRequest) => Promise<OutboundHttpResponse>
} = {}): MainActionDefinition<HttpRequestActionConfig> {
  const sendRequest = deps.sendRequest ?? sendOutboundHttpRequest
  return {
    manifest: httpRequestActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "network.connect",
      actor: context.actor,
      resource: sanitizeUrl(config.url),
      context: {
        source: "task-scheduler",
        actionType: httpRequestActionManifest.id,
        taskId: context.taskId,
        runId: context.runId,
        triggeredBy: context.triggeredBy,
        method: config.method,
        url: sanitizeUrl(config.url),
        headerKeys: config.headers ? Object.keys(config.headers).sort() : [],
        timeoutMins: config.timeoutMins,
      },
    }),
    execute: async ({ config, context }) => {
      const startMs = Date.now()
      let url: string
      try {
        url = buildUrl(config)
      } catch {
        return {
          status: "failed",
          error: `无效的 URL：${config.url || "(空)"}`,
          metrics: { durationMs: Date.now() - startMs },
        }
      }

      try {
        const response = await sendRequest({
          method: config.method,
          url,
          headers: buildHeaders(config),
          body: buildBody(config),
          timeoutMs: config.timeoutMins === null ? undefined : (config.timeoutMins ?? 5) * 60_000,
          abortSignal: context.abortSignal,
        })
        return {
          status: response.status >= 400 ? "failed" : "success",
          summary: `${String(response.status)} ${response.statusText}`,
          logs: response.body ? [{ label: "response", value: response.body }] : [],
          outputs: {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            body: response.body,
          },
          metrics: { httpStatus: response.status, durationMs: Date.now() - startMs },
        }
      } catch (err) {
        if (context.abortSignal.aborted) {
          return {
            status: "cancelled",
            summary: "请求已取消",
            metrics: { durationMs: Date.now() - startMs },
          }
        }
        const message = err instanceof Error ? err.message : String(err)
        const isTimeout = message.includes("timeout") || message.includes("aborted")
        return {
          status: isTimeout ? "timeout" : "failed",
          error: isTimeout ? "请求超时" : `请求失败：${message}`,
          metrics: { durationMs: Date.now() - startMs },
        }
      }
    },
  }
}

function buildUrl(config: HttpRequestActionConfig): string {
  const url = new URL(config.url)
  for (const [key, value] of Object.entries(config.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function buildBody(config: HttpRequestActionConfig): string | undefined {
  if (config.bodyType === "none") return undefined
  return config.body ?? ""
}
