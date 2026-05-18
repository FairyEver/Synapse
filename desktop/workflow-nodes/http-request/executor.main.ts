import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { HttpRequestNodeConfig } from "./schema"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { createMainLogger } from "../../electron/services/log-store"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"

const logger = createMainLogger("workflow.node.http-request-executor")

export const httpRequestNodeExecutor: NodeExecutor<HttpRequestNodeConfig> = {
  async execute(input: NodeExecutionInput<HttpRequestNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, runtimeDeps, resolvedVariables } = input

    if (!runtimeDeps?.sendHttpRequest) {
      return { status: "failed", output: "", error: "HTTP 请求能力不可用", durationMs: Date.now() - start }
    }

    input.onProgress?.("building_request", "构建请求…")
    const interpolated = interpolateConfig(config, resolvedVariables)

    logger.info("http request node executing", {
      runId: context.runId, method: interpolated.method, urlLength: interpolated.url.length,
    })

    input.onProgress?.("sending_request", "发送请求…")
    try {
      const url = buildUrl(interpolated)
      const response = await runtimeDeps.sendHttpRequest({
        method: interpolated.method,
        url,
        headers: buildHeaders(interpolated),
        body: buildBody(interpolated),
        timeoutMs: (config.timeoutMins ?? 5) * 60_000,
        abortSignal: context.abortSignal,
      })

      const durationMs = Date.now() - start
      const output = response.body ?? ""

      input.onProgress?.("processing_response", "处理响应…")
      logger.info("http request node succeeded", {
        runId: context.runId, method: config.method, status: response.status,
        outputLength: output.length, durationMs,
      })

      return {
        status: "success",
        output,
        outputs: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body,
        },
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      logger.warn("http request node failed", {
        runId: context.runId, method: config.method,
        errorMessage: truncateWithEllipsis(message, 500), durationMs,
      })
      return {
        status: "failed",
        output: "",
        error: `HTTP 请求失败：${truncateWithEllipsis(message, 120)}`,
        durationMs,
      }
    }
  },
}

function buildHeaders(config: HttpRequestNodeConfig): Record<string, string> | undefined {
  const headers = config.headers ? { ...config.headers } : {} as Record<string, string>

  if (config.auth?.type === "bearer" && config.auth.bearerToken) {
    headers["Authorization"] = `Bearer ${config.auth.bearerToken}`
  } else if (config.auth?.type === "basic" && config.auth.basicUsername) {
    const encoded = Buffer.from(`${config.auth.basicUsername}:${config.auth.basicPassword ?? ""}`).toString("base64")
    headers["Authorization"] = `Basic ${encoded}`
  }

  return Object.keys(headers).length > 0 ? headers : undefined
}

function buildUrl(config: HttpRequestNodeConfig): string {
  let raw = config.url
  if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(raw)) {
    raw = `https://${raw}`
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`URL 无法解析，请确保包含合法协议前缀（如 https://）：${config.url}`)
  }
  for (const [key, value] of Object.entries(config.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function buildBody(config: HttpRequestNodeConfig): string | undefined {
  if (config.bodyType === "none") return undefined
  return config.body ?? ""
}

/** Interpolate {{var}} templates in all string config fields. */
function interpolateConfig(config: HttpRequestNodeConfig, vars: Record<string, string>): HttpRequestNodeConfig {
  const url = interpolatePrompt(config.url, vars)
  const headers = config.headers
    ? Object.fromEntries(
        Object.entries(config.headers).map(([k, v]) => [k, interpolatePrompt(v, vars)]),
      )
    : undefined
  const query = config.query
    ? Object.fromEntries(
        Object.entries(config.query).map(([k, v]) => [k, interpolatePrompt(v, vars)]),
      )
    : undefined
  const body = config.body ? interpolatePrompt(config.body, vars) : undefined
  return { ...config, url, headers, query, body }
}
