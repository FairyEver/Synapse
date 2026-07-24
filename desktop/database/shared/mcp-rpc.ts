// MCP JSON-RPC handler used by the in-process HTTP MCP server. This module
// decides what to respond with for a parsed request and a provided executor.

import {
  MCP_TOOL_ACTIONS,
  buildAllMcpTools,
  getActionDomainId,
} from "../../synapse-capabilities/shared/registry"
import { sanitizeError } from "../../src/lib/error-sanitize"
import { JSON_REPAIR_CAPABILITY_ID } from "../../app-capabilities/json-repair/shared/capability"

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

function normalizeToolResult(action: string, result: unknown): unknown {
  if (
    action === JSON_REPAIR_CAPABILITY_ID
    && isFailedDispatchResult(result)
    && isRecord(result.data)
  ) {
    return result.data
  }
  if (!isRecord(result) || result.ok !== true) return result

  const domainId = getActionDomainId(action)
  if (action.startsWith("app.terminal.")) return result
  if (domainId && domainId !== "database") {
    return result.data ?? null
  }
  const normalizedAction = action.startsWith("app.database.")
    ? action.replace("app.database.", "database.")
    : action

  switch (normalizedAction) {
    case "database.table.list":
    case "database.table.describe":
    case "database.overview.get":
    case "database.row.create":
    case "database.rows.create":
    case "database.row.count":
    case "database.log.list":
    case "database.sql.read":
    case "database.sql.execute":
    case "database.choice_usage.get":
    case "database.folder.list":
    case "database.folder.create":
      return result.data

    case "database.row.list":
      return {
        rows: Array.isArray(result.data) ? result.data : [],
        total: numberOrZero(result.total),
      }

    case "database.row.update":
    case "database.row.delete":
      return { affected: numberOrZero(result.affected) }

    case "database.rows.update":
    case "database.rows.delete":
      return {
        affected: numberOrZero(result.affected),
        ids: idsFromData(result.data),
        ...(isDryRun(result.data) ? { dryRun: true } : {}),
      }

    default:
      if (Object.prototype.hasOwnProperty.call(result, "data")) return result.data
      return { ok: true }
  }
}

function isFailedDispatchResult(
  result: unknown,
): result is Record<string, unknown> & { readonly ok: false } {
  return isRecord(result) && result.ok === false
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeMcpErrorMessage(error: unknown): string {
  return sanitizeError(errorMessage(error)) || "unknown error"
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
      const payload = normalizeToolResult(MCP_TOOL_ACTIONS[toolName] ?? toolName, result)
      return {
        kind: "result",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          ...(isFailedDispatchResult(result) ? { isError: true } : {}),
        },
      }
    } catch (error) {
      const message = sanitizeMcpErrorMessage(error)
      return {
        kind: "result",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${message}` }],
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

export { processMcpRequest, sanitizeMcpErrorMessage, serializeJsonRpcPayload, PROTOCOL_VERSION }
export type { JsonRpcId, JsonRpcRequest, McpRpcResponse, McpServerIdentity, ToolExecutor }
