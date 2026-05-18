import { handleValidatedIpc } from "../../ipc/validated-ipc"
import { sendOutboundHttpRequest, type OutboundHttpResponse } from "../../runtime/network"
import { sanitizeError } from "../../services/error-sanitize"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
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

type HttpTestRequestDeps = {
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly sendRequest?: typeof sendOutboundHttpRequest
}

export async function sendHttpTestRequest(
  config: HttpRequestActionConfig,
  deps: HttpTestRequestDeps,
): Promise<HttpTestResponse> {
  const startedAt = performance.now()
  const url = buildUrl(config)
  const resource = sanitizeUrlForAudit(url)
  const permission = await deps.permissionGuard.check({
    action: "network.connect",
    actor: { kind: "user" },
    resource,
    context: { source: "http-test" },
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "network.connect",
      actor: { kind: "user" },
      resource,
      outcome: "denied",
      metadata: {
        source: "http-test",
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }

  try {
    const response = await (deps.sendRequest ?? sendOutboundHttpRequest)({
      method: config.method,
      url,
      headers: buildHeaders(config),
      body: buildBody(config),
      timeoutMs: config.timeoutMins === null ? undefined : (config.timeoutMins ?? 5) * 60_000,
    })
    deps.auditSink.record({
      action: "network.connect",
      actor: { kind: "user" },
      resource,
      outcome: "allowed",
      metadata: { source: "http-test", status: response.status },
    })
    return toHttpTestResponse(response, startedAt)
  } catch (error) {
    deps.auditSink.record({
      action: "network.connect",
      actor: { kind: "user" },
      resource,
      outcome: "failed",
      metadata: {
        source: "http-test",
        error: sanitizeError(error instanceof Error ? error.message : String(error)),
      },
    })
    throw error
  }
}

export function registerHttpTestHandlers(deps: HttpTestRequestDeps): void {
  if (handlersRegistered) return

  handleValidatedIpc(HTTP_TEST_CHANNEL, async (_event, config: HttpRequestActionConfig): Promise<HttpTestResponse> => {
    return sendHttpTestRequest(config, deps)
  })

  handlersRegistered = true
}

function toHttpTestResponse(response: OutboundHttpResponse, startedAt: number): HttpTestResponse {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers ?? {},
    body: response.body ?? "",
    durationMs: Math.round(performance.now() - startedAt),
  }
}

const SENSITIVE_PARAM_NAMES = new Set(["token", "key", "secret", "password", "auth", "api_key", "apikey", "access_token"])

function sanitizeUrlForAudit(raw: string): string {
  try {
    const url = new URL(raw)
    for (const param of url.searchParams.keys()) {
      if (SENSITIVE_PARAM_NAMES.has(param.toLowerCase())) {
        url.searchParams.set(param, "[REDACTED]")
      }
    }
    return url.toString()
  } catch {
    return sanitizeError(raw)
  }
}
