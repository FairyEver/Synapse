import { handleValidatedIpc } from "../../ipc/validated-ipc"
import { sendOutboundHttpRequest, type OutboundHttpResponse } from "../../runtime/network"
import { sanitizeError } from "../../services/error-sanitize"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { HttpRequestActionConfig } from "../../../action-packages/builtin/http-request/schema"
import {
  buildHttpRequestUrl,
  buildOutboundHttpRequest,
  parseHttpRequestConfig,
  redactHttpResponseBody,
} from "../../../action-packages/builtin/http-request/request-builders.main"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"

export const HTTP_TEST_CHANNEL = "synapse:app:http:operation:test_request"

export interface HttpTestResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: string
  readonly durationMs: number
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
  const parsedConfig = parseHttpRequestConfig(config)
  const url = buildHttpRequestUrl(parsedConfig)
  const resource = sanitizeUrl(url)
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
    const response = await (deps.sendRequest ?? sendOutboundHttpRequest)(buildOutboundHttpRequest(parsedConfig, {
      url,
    }))
    deps.auditSink.record({
      action: "network.connect",
      actor: { kind: "user" },
      resource,
      outcome: "allowed",
      metadata: { source: "http-test", status: response.status },
    })
    return toHttpTestResponse(response, startedAt)
  } catch (error) {
    const safeMessage = sanitizeError(error instanceof Error ? error.message : String(error))
    deps.auditSink.record({
      action: "network.connect",
      actor: { kind: "user" },
      resource,
      outcome: "failed",
      metadata: {
        source: "http-test",
        error: safeMessage,
      },
    })
    throw new Error(safeMessage)
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
    body: redactHttpResponseBody(response.body),
    durationMs: Math.round(performance.now() - startedAt),
  }
}
