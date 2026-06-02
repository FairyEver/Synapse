#!/usr/bin/env node

const [major] = process.versions.node.split(".").map(Number)
if (major < 18) {
  process.stderr.write(`Error: Synapse MCP server requires Node.js >= 18.0.0 (current: ${process.versions.node})\n`)
  process.exit(1)
}

import { createInterface } from "node:readline"
import { apiCall, isAppRunning, readServerInfo, type ServerInfo } from "../shared/resolve-user-data"
import { MCP_TOOL_ACTIONS } from "../../synapse-capabilities/shared/registry"
import {
  processMcpRequest,
  sanitizeMcpErrorMessage,
  serializeJsonRpcPayload,
  type JsonRpcRequest,
  type McpRpcResponse,
} from "../shared/mcp-rpc"
import { SYNAPSE_MCP_SERVER_IDENTITY } from "../shared/server-identity"

let serverInfo: ServerInfo | null = null

function getServerInfo(): ServerInfo {
  if (serverInfo && !isAppRunning(serverInfo.pid)) {
    serverInfo = null
  }
  if (!serverInfo) {
    const info = readServerInfo()
    if (!isAppRunning(info.pid)) {
      throw new Error("Synapse app is not running")
    }
    serverInfo = info
  }
  return serverInfo
}

function clearServerInfoCache(): void {
  serverInfo = null
}

async function executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const action = MCP_TOOL_ACTIONS[toolName]
  if (!action) throw new Error(`Unknown tool: ${toolName}`)
  try {
    return await apiCall(getServerInfo(), action, args, "mcp-stdio")
  } catch (error) {
    clearServerInfoCache()
    throw error
  }
}

function writeResponse(response: McpRpcResponse): void {
  const payload = serializeJsonRpcPayload(response)
  if (payload !== null) {
    process.stdout.write(payload + "\n")
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    writeResponse({ kind: "error", id: request.id ?? null, code: -32600, message: "Invalid Request: missing jsonrpc 2.0 or method" })
    return
  }

  const response = await processMcpRequest(request, SYNAPSE_MCP_SERVER_IDENTITY, executeTool)
  writeResponse(response)
}

const rl = createInterface({ input: process.stdin })

rl.on("line", (line) => {
  if (!line.trim()) return
  let request: JsonRpcRequest
  try {
    request = JSON.parse(line) as JsonRpcRequest
  } catch {
    writeResponse({ kind: "error", id: null, code: -32700, message: "Parse error" })
    return
  }
  handleRequest(request).catch((error) => {
    writeResponse({ kind: "error", id: request.id ?? null, code: -32603, message: `Internal error: ${sanitizeMcpErrorMessage(error)}` })
  })
})
