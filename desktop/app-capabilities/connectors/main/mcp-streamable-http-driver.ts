import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type {
  AgentContribution,
  BuiltinConnectorDefinition,
  ConnectorDriver,
  ConnectorProbeErrorCode,
  ProbeResult,
} from "./types"

const MCP_PROTOCOL_VERSION = "2025-06-18"
const PROBE_TIMEOUT_MS = 4_000

type McpStreamableHttpDriverDeps = {
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly fetchImpl?: typeof fetch
}

class McpProbeError extends Error {
  constructor(readonly code: ConnectorProbeErrorCode) {
    super(code)
  }
}

export function createMcpStreamableHttpDriver(deps: McpStreamableHttpDriverDeps): ConnectorDriver {
  return {
    probe: (definition) => probeMcpStreamableHttp(definition, deps),
    createAgentContribution(definition): AgentContribution {
      if (definition.integration.kind !== "mcp-streamable-http") {
        throw new Error(`Unsupported connector integration: ${definition.integration.kind}`)
      }
      assertLocalMcpEndpoint(definition.integration.endpoint)
      return {
        mcpServers: [{
          name: definition.id,
          config: { type: "http", url: definition.integration.endpoint },
        }],
        skillPackageIds: [definition.skillPackageId],
      }
    },
  }
}

async function probeMcpStreamableHttp(
  definition: BuiltinConnectorDefinition,
  deps: McpStreamableHttpDriverDeps,
): Promise<ProbeResult> {
  if (definition.integration.kind !== "mcp-streamable-http") {
    return { ok: false, errorCode: "invalid_endpoint" }
  }

  try {
    assertLocalMcpEndpoint(definition.integration.endpoint)
  } catch {
    return { ok: false, errorCode: "invalid_endpoint" }
  }

  const actor = { kind: "user" as const }
  const context = { source: "connectors.probe", connectorId: definition.id }
  let permission: Awaited<ReturnType<PermissionGuard["check"]>>
  try {
    permission = await deps.permissionGuard.check({
      action: "network.connect",
      actor,
      resource: definition.integration.endpoint,
      context,
    })
  } catch {
    deps.auditSink.record({
      action: "network.connect",
      actor,
      resource: definition.integration.endpoint,
      outcome: "failed",
      metadata: { ...context, errorCode: "permission_denied" },
    })
    return { ok: false, errorCode: "permission_denied" }
  }
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "network.connect",
      actor,
      resource: definition.integration.endpoint,
      outcome: "denied",
      metadata: { ...context, policyId: permission.policyId },
    })
    return { ok: false, errorCode: "permission_denied" }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const initialized = await mcpRequest(deps.fetchImpl ?? fetch, definition.integration.endpoint, controller.signal, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Synapse", version: "1.0.0" },
      },
      invalidResponseCode: "initialize_failed",
    })
    if (!initialized.result || typeof initialized.result !== "object") {
      throw new McpProbeError("initialize_failed")
    }

    await mcpRequest(deps.fetchImpl ?? fetch, definition.integration.endpoint, controller.signal, {
      method: "notifications/initialized",
      params: {},
      sessionId: initialized.sessionId,
      allowEmpty: true,
      invalidResponseCode: "initialize_failed",
    })
    const tools = await mcpRequest(deps.fetchImpl ?? fetch, definition.integration.endpoint, controller.signal, {
      id: 2,
      method: "tools/list",
      params: {},
      sessionId: initialized.sessionId,
      invalidResponseCode: "tools_list_failed",
    })
    const toolList = tools.result && typeof tools.result === "object" && "tools" in tools.result
      ? (tools.result as { readonly tools?: unknown }).tools
      : undefined
    if (!Array.isArray(toolList)) throw new McpProbeError("tools_list_failed")

    const toolNames = new Set(toolList.flatMap((tool) => (
      typeof tool === "object" && tool !== null && "name" in tool && typeof tool.name === "string"
        ? [tool.name]
        : []
    )))
    const missingRequiredTool = definition.integration.requiredTools?.some((name) => !toolNames.has(name)) ?? false
    if (missingRequiredTool) throw new McpProbeError("required_tools_missing")

    deps.auditSink.record({
      action: "network.connect",
      actor,
      resource: definition.integration.endpoint,
      outcome: "allowed",
      metadata: { ...context, toolCount: toolList.length },
    })
    return { ok: true, toolCount: toolList.length }
  } catch (error) {
    const errorCode = probeErrorCode(error)
    deps.auditSink.record({
      action: "network.connect",
      actor,
      resource: definition.integration.endpoint,
      outcome: "failed",
      metadata: { ...context, errorCode },
    })
    return { ok: false, errorCode }
  } finally {
    clearTimeout(timeout)
  }
}

type McpRequest = {
  readonly id?: number
  readonly method: string
  readonly params: Record<string, unknown>
  readonly sessionId?: string
  readonly allowEmpty?: boolean
  readonly invalidResponseCode: ConnectorProbeErrorCode
}

async function mcpRequest(
  fetchImpl: typeof fetch,
  endpoint: string,
  signal: AbortSignal,
  request: McpRequest,
): Promise<{ readonly result?: unknown; readonly sessionId?: string }> {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    redirect: "manual",
    signal,
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...(request.sessionId ? { "Mcp-Session-Id": request.sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(request.id === undefined ? {} : { id: request.id }),
      method: request.method,
      params: request.params,
    }),
  })
  if (response.status >= 300 && response.status < 400) throw new McpProbeError("redirect_not_allowed")
  if (!response.ok) throw new McpProbeError(request.invalidResponseCode)
  if (request.allowEmpty && (response.status === 202 || response.status === 204)) {
    return { sessionId: request.sessionId }
  }

  const body = await response.text()
  if (request.allowEmpty && body.trim().length === 0) return { sessionId: request.sessionId }
  const payload = parseMcpPayload(body)
  if (!payload || typeof payload !== "object" || "error" in payload) {
    throw new McpProbeError(request.invalidResponseCode)
  }
  return {
    result: (payload as { readonly result?: unknown }).result,
    sessionId: response.headers.get("mcp-session-id") ?? request.sessionId,
  }
}

function parseMcpPayload(body: string): unknown {
  const trimmed = body.trim()
  if (!trimmed) return undefined
  try { return JSON.parse(trimmed) }
  catch { /* Streamable HTTP may return one or more SSE data frames. */ }
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue
    try { return JSON.parse(line.slice(5).trim()) }
    catch { continue }
  }
  return undefined
}

function probeErrorCode(error: unknown): ConnectorProbeErrorCode {
  if (error instanceof McpProbeError) return error.code
  if (error instanceof Error && error.name === "AbortError") return "probe_timeout"
  return "transport_error"
}

export function assertLocalMcpEndpoint(endpoint: string): void {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error("Invalid connector endpoint")
  }
  const port = Number(url.port)
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
    || url.username.length > 0
    || url.password.length > 0
    || url.hash.length > 0
  ) {
    throw new Error("Invalid connector endpoint")
  }
}
