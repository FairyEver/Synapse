// Shared MCP JSON-RPC handler used by both the in-process HTTP MCP server and
// the stdio MCP bridge. The transport layer (HTTP body vs. stdin line) is
// owned by each caller; this module only decides what to respond with for a
// given parsed request, given a tool executor provided by the caller.

import {
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getMcpToolDomainId,
} from "../../synapse-capabilities/shared/registry"

type JsonRpcId = number | string | null

type JsonRpcRequest = {
  jsonrpc: "2.0"
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

type McpRpcResponse =
  | { kind: "result"; id: JsonRpcId; result: unknown }
  | { kind: "error"; id: JsonRpcId; code: number; message: string }
  | { kind: "none" }

type McpServerIdentity = {
  name: string
  version: string
}

type ToolExecutor = (toolName: string, args: Record<string, unknown>) => unknown | Promise<unknown>

const PROTOCOL_VERSION = "2024-11-05"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function idsFromData(data: unknown): unknown[] {
  if (!isRecord(data) || !Array.isArray(data.ids)) return []
  return data.ids
}

function isDryRun(data: unknown): boolean {
  return isRecord(data) && data.dryRun === true
}

function normalizeToolResult(toolName: string, result: unknown): unknown {
  if (!isRecord(result) || result.ok !== true) return result

  if (getMcpToolDomainId(toolName) === "scheduler") {
    return result.data
  }

  switch (toolName) {
    case "list_tables":
    case "describe_table":
    case "database_overview":
    case "insert":
    case "batch_insert":
    case "count":
    case "operation_log":
    case "read_sql":
    case "raw_sql":
    case "get_column_choices_usage":
      return result.data

    case "query":
      return {
        rows: Array.isArray(result.data) ? result.data : [],
        total: numberOrZero(result.total),
      }

    case "update":
    case "delete":
      return { affected: numberOrZero(result.affected) }

    case "update_where":
    case "delete_where":
      return {
        affected: numberOrZero(result.affected),
        ids: idsFromData(result.data),
        ...(isDryRun(result.data) ? { dryRun: true } : {}),
      }

    default:
      return { ok: true }
  }
}

async function processMcpRequest(
  req: JsonRpcRequest,
  identity: McpServerIdentity,
  executeTool: ToolExecutor,
): Promise<McpRpcResponse> {
  const id = req.id ?? null
  const method = req.method

  if (method === "initialize") {
    return {
      kind: "result",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: identity,
      },
    }
  }

  // All MCP notifications per spec expect no response.
  if (method.startsWith("notifications/")) {
    return { kind: "none" }
  }

  if (method === "ping") {
    return { kind: "result", id, result: {} }
  }

  if (method === "tools/list") {
    return { kind: "result", id, result: { tools: buildAllMcpTools() } }
  }

  if (method === "tools/call") {
    const params = req.params
    if (!params || typeof params !== "object") {
      return {
        kind: "result",
        id,
        result: { content: [{ type: "text", text: "Error: missing params" }], isError: true },
      }
    }
    const toolName = (params as { name: string }).name
    const toolArgs = (params as { arguments?: Record<string, unknown> }).arguments ?? {}

    if (!(toolName in MCP_TOOL_ACTIONS)) {
      return {
        kind: "result",
        id,
        result: { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true },
      }
    }

    try {
      const result = await executeTool(toolName, toolArgs)
      const payload = normalizeToolResult(toolName, result)
      return {
        kind: "result",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] },
      }
    } catch (error) {
      return {
        kind: "result",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
          isError: true,
        },
      }
    }
  }

  return { kind: "error", id, code: -32601, message: `Method not found: ${method}` }
}

function serializeJsonRpcPayload(response: McpRpcResponse): string | null {
  if (response.kind === "none") return null
  if (response.kind === "result") {
    return JSON.stringify({ jsonrpc: "2.0", id: response.id, result: response.result })
  }
  return JSON.stringify({ jsonrpc: "2.0", id: response.id, error: { code: response.code, message: response.message } })
}

export { processMcpRequest, serializeJsonRpcPayload, PROTOCOL_VERSION }
export type { JsonRpcId, JsonRpcRequest, McpRpcResponse, McpServerIdentity, ToolExecutor }
