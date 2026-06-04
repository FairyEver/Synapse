import type {
  OutboundHttpRequest,
  OutboundHttpResponse,
} from "../../../electron/runtime/network"
import { sendOutboundHttpRequest } from "../../../electron/runtime/network"
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"
import { httpRequestActionManifest } from "./manifest"
import {
  buildHttpRequestUrl,
  buildOutboundHttpRequest,
  redactHttpResponseBody,
} from "./request-builders.main"
import type { HttpRequestActionConfig } from "./schema"

function getPermissionAuthType(config: HttpRequestActionConfig): "bearer" | "basic" | null {
  if (config.auth?.type === "bearer" && config.auth.bearerToken?.trim()) {
    return "bearer"
  }

  if (config.auth?.type === "basic" && config.auth.basicUsername?.trim()) {
    return "basic"
  }

  return null
}

function buildPermissionHeaderKeys(config: HttpRequestActionConfig, authType: "bearer" | "basic" | null): string[] {
  const headerKeys = new Set(Object.keys(config.headers ?? {}))

  if (config.bodyType === "json" && !hasHeaderKey(headerKeys, "content-type")) {
    headerKeys.add("Content-Type")
  }
  if (authType) {
    headerKeys.add("Authorization")
  }

  return [...headerKeys].sort()
}

function hasHeaderKey(headerKeys: Set<string>, key: string): boolean {
  const target = key.toLowerCase()
  return [...headerKeys].some((headerKey) => headerKey.toLowerCase() === target)
}

export function createHttpRequestAction(deps: {
  readonly sendRequest?: (request: OutboundHttpRequest) => Promise<OutboundHttpResponse>
} = {}): MainActionDefinition<HttpRequestActionConfig> {
  const sendRequest = deps.sendRequest ?? sendOutboundHttpRequest
  return {
    manifest: httpRequestActionManifest,
    buildPermissionRequest: ({ config, context }) => {
      const authType = getPermissionAuthType(config)

      return {
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
          headerKeys: buildPermissionHeaderKeys(config, authType),
          authType: authType ?? undefined,
          timeoutMins: config.timeoutMins,
        },
      }
    },
    execute: async ({ config, context }) => {
      const startMs = Date.now()
      let url: string
      try {
        url = buildHttpRequestUrl(config)
      } catch {
        return {
          status: "failed",
          error: `无效的 URL：${config.url || "(空)"}`,
          metrics: { durationMs: Date.now() - startMs },
        }
      }

      try {
        const response = await sendRequest(buildOutboundHttpRequest(config, {
          url,
          abortSignal: context.abortSignal,
        }))
        const redactedBody = redactHttpResponseBody(response.body)
        return {
          status: response.status >= 400 ? "failed" : "success",
          summary: `${String(response.status)} ${response.statusText}`,
          logs: redactedBody ? [{ label: "response", value: redactedBody }] : [],
          outputs: {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            body: redactedBody,
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
