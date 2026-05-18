import type {
  OutboundHttpRequest,
  OutboundHttpResponse,
} from "../../../electron/runtime/network"
import { sendOutboundHttpRequest } from "../../../electron/runtime/network"
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { httpRequestActionManifest } from "./manifest"
import type { HttpRequestActionConfig } from "./schema"

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
      resource: config.url,
      context: {
        source: "task-scheduler",
        actionType: httpRequestActionManifest.id,
        taskId: context.taskId,
        runId: context.runId,
        triggeredBy: context.triggeredBy,
        method: config.method,
        url: config.url,
        headerKeys: config.headers ? Object.keys(config.headers).sort() : [],
        timeoutMins: config.timeoutMins,
      },
    }),
    execute: async ({ config, context }) => {
      const response = await sendRequest({
        method: config.method,
        url: buildUrl(config),
        headers: buildHeaders(config),
        body: buildBody(config),
        timeoutMs: config.timeoutMins === null ? undefined : (config.timeoutMins ?? 5) * 60_000,
        abortSignal: context.abortSignal,
      })
      return {
        status: "success",
        summary: `${String(response.status)} ${response.statusText}`,
        logs: response.body ? [{ label: "response", value: response.body }] : [],
        outputs: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body,
        },
        metrics: { httpStatus: response.status },
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
