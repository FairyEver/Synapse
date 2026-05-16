import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { HttpRequestNodeConfig } from "./schema"
import { createMainLogger } from "../../electron/services/log-store"

const logger = createMainLogger("workflow.node.http-request-executor")

export const httpRequestNodeExecutor: NodeExecutor<HttpRequestNodeConfig> = {
  async execute(input: NodeExecutionInput<HttpRequestNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, runtimeDeps } = input

    if (!runtimeDeps?.sendHttpRequest) {
      return { status: "failed", output: "", error: "HTTP 请求能力不可用", durationMs: Date.now() - start }
    }

    input.onProgress?.("building_request", "构建请求…")

    logger.info("http request node executing", {
      runId: context.runId, method: config.method, urlLength: config.url.length,
    })

    input.onProgress?.("sending_request", "发送请求…")
    try {
      const url = buildUrl(config)
      const response = await runtimeDeps.sendHttpRequest({
        method: config.method,
        url,
        headers: buildHeaders(config),
        body: buildBody(config),
        timeoutMs: config.timeoutMins === null ? undefined : (config.timeoutMins ?? 5) * 60_000,
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
        errorMessage: message.length <= 500 ? message : message.slice(0, 500) + "...", durationMs,
      })
      return {
        status: "failed",
        output: "",
        error: `HTTP 请求失败：${message.length <= 120 ? message : message.slice(0, 120) + "..."}`,
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
  const url = new URL(config.url)
  for (const [key, value] of Object.entries(config.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function buildBody(config: HttpRequestNodeConfig): string | undefined {
  if (config.bodyType === "none") return undefined
  return config.body ?? ""
}
