// Shared MCP JSON-RPC handler used by both the in-process HTTP MCP server and
// the stdio MCP bridge. The transport layer (HTTP body vs. stdin line) is
// owned by each caller; this module only decides what to respond with for a
// given parsed request, given a tool executor provided by the caller.

import { buildTools, MCP_TOOL_ACTIONS } from "./mcp-tools"

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
    return { kind: "result", id, result: { tools: buildTools() } }
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
      return {
        kind: "result",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
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
