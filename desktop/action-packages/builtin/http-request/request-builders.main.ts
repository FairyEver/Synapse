import type { OutboundHttpRequest } from "../../../electron/runtime/network"
import { redactSensitiveText } from "../../../src/lib/agent-redaction"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"
import {
  httpRequestActionConfigSchema,
  type HttpRequestActionConfig,
} from "./schema"

export const HTTP_REQUEST_MAX_RESPONSE_BODY_BYTES = 5 * 1024 * 1024

export function parseHttpRequestConfig(config: HttpRequestActionConfig): HttpRequestActionConfig {
  const result = httpRequestActionConfigSchema.safeParse(config)
  if (result.success) return result.data
  throw new Error(result.error.issues.map((issue) => issue.message).join("；"))
}

export function buildHttpRequestUrl(config: HttpRequestActionConfig): string {
  let url: URL
  try {
    url = new URL(withDefaultProtocol(config.url))
  } catch {
    throw new Error("URL 无法解析，请确保包含合法协议前缀（如 https://）")
  }
  for (const [key, value] of Object.entries(config.query ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

export function buildHttpRequestHeaders(config: HttpRequestActionConfig): Record<string, string> | undefined {
  const headers = config.headers ? { ...config.headers } : {} as Record<string, string>

  if (config.bodyType === "json" && !hasHeader(headers, "content-type")) {
    headers["Content-Type"] = "application/json"
  }

  if (config.auth?.type === "bearer") {
    const bearerToken = config.auth.bearerToken?.trim()
    if (!bearerToken) throw new Error("Bearer Token 不能为空")
    headers["Authorization"] = `Bearer ${bearerToken}`
  } else if (config.auth?.type === "basic") {
    const basicUsername = config.auth.basicUsername?.trim()
    if (!basicUsername) throw new Error("Basic Auth 用户名不能为空")
    const encoded = Buffer.from(`${basicUsername}:${config.auth.basicPassword ?? ""}`).toString("base64")
    headers["Authorization"] = `Basic ${encoded}`
  }

  return Object.keys(headers).length > 0 ? headers : undefined
}

export function buildHttpRequestBody(config: HttpRequestActionConfig): string | undefined {
  assertMethodAllowsBody(config)
  if (config.bodyType === "none") return undefined
  return config.body ?? ""
}

export function buildOutboundHttpRequest(
  config: HttpRequestActionConfig,
  input: {
    readonly url: string
    readonly abortSignal?: AbortSignal
  },
): OutboundHttpRequest {
  return {
    method: config.method,
    url: input.url,
    headers: buildHttpRequestHeaders(config),
    body: buildHttpRequestBody(config),
    timeoutMs: config.timeoutMins === null ? undefined : (config.timeoutMins ?? 5) * 60_000,
    abortSignal: input.abortSignal,
    maxResponseBodyBytes: HTTP_REQUEST_MAX_RESPONSE_BODY_BYTES,
  }
}

export function redactHttpResponseBody(body: string | undefined): string {
  return body ? redactSensitiveText(body) : ""
}

const SENSITIVE_RESPONSE_HEADER_PATTERN = /^(authorization|proxy-authorization|cookie|set-cookie|.*(?:secret|token|password|credential|api[-_]?key|session[-_]?key).*)$/i

export function redactHttpResponseHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_RESPONSE_HEADER_PATTERN.test(key) ? "[redacted]" : redactHttpResponseHeaderValue(value),
    ]),
  )
}

function redactHttpResponseHeaderValue(value: string): string {
  return redactSensitiveText(sanitizeUrl(value))
}

function assertMethodAllowsBody(config: HttpRequestActionConfig): void {
  if (methodDisallowsBody(config.method) && config.bodyType !== "none") {
    throw new Error(`${config.method} 请求不支持 Body`)
  }
}

function methodDisallowsBody(method: string): boolean {
  return method === "GET" || method === "HEAD"
}

function withDefaultProtocol(raw: string): string {
  return /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`
}

function hasHeader(headers: Record<string, string>, key: string): boolean {
  const target = key.toLowerCase()
  return Object.keys(headers).some((headerKey) => headerKey.toLowerCase() === target)
}
