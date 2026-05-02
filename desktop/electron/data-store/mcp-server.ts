import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { createMainLogger } from "../services/log-store"
import type { SynapseActionRouter } from "../capabilities/action-router"
import { MCP_TOOL_ACTIONS } from "../../synapse-capabilities/shared/registry"
import {
  processMcpRequest,
  serializeJsonRpcPayload,
  type JsonRpcRequest,
  type McpRpcResponse,
} from "../../data-store/shared/mcp-rpc"
import { SYNAPSE_DATA_SERVER_IDENTITY } from "../../data-store/shared/server-identity"

const logger = createMainLogger("data-store.mcp-server")

const MCP_DEFAULT_PORT = 23578
const MCP_PORT_ATTEMPTS = 5
const MAX_BODY_SIZE = 1024 * 1024

let server: Server | null = null
let activePort = 0
let actionRouter: SynapseActionRouter | null = null

// MCP tool calls route through the same dispatcher as the HTTP API so the two
// protocols can never disagree about argument handling or response shape.
async function executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const action = MCP_TOOL_ACTIONS[toolName]
  if (!action) throw new Error(`Unknown tool: ${toolName}`)
  if (!actionRouter) throw new Error("Synapse action router is not initialized")
  return actionRouter.dispatch(action, args, { source: "mcp-http" })
}

// --- HTTP transport ---

function sendRpcResponse(res: ServerResponse, response: McpRpcResponse): void {
  if (response.kind === "none") {
    res.writeHead(204)
    res.end()
    return
  }
  const body = serializeJsonRpcPayload(response) ?? ""
  res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) { req.destroy(); reject(new Error("Request body too large")); return }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== "POST" || req.url !== "/mcp") {
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not found" }))
    return
  }

  let body: JsonRpcRequest
  try {
    body = JSON.parse(await readBody(req)) as JsonRpcRequest
  } catch {
    sendRpcResponse(res, { kind: "error", id: null, code: -32700, message: "Parse error" })
    return
  }

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    sendRpcResponse(res, { kind: "error", id: body.id ?? null, code: -32600, message: "Invalid Request" })
    return
  }

  const response = await processMcpRequest(body, SYNAPSE_DATA_SERVER_IDENTITY, executeTool)
  sendRpcResponse(res, response)
}

// --- Server lifecycle ---

function tryListen(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      handleRequest(req, res).catch((error) => {
        logger.error("Unhandled MCP HTTP error.", { error })
        try { res.writeHead(500); res.end() } catch { /* ignore */ }
      })
    })

    s.once("error", (error) => {
      // Release the unbound server so we don't leak the descriptor on retry.
      s.close(() => { /* already failed; ignore close callback */ })
      reject(error)
    })

    s.listen(port, "127.0.0.1", () => {
      server = s
      activePort = port
      resolve(port)
    })
  })
}

async function startMcpServer(router: SynapseActionRouter): Promise<number> {
  actionRouter = router
  for (let i = 0; i < MCP_PORT_ATTEMPTS; i++) {
    const port = MCP_DEFAULT_PORT + i
    try {
      const bound = await tryListen(port)
      logger.info("MCP HTTP server started.", { port: bound })
      return bound
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        logger.warn(`MCP port ${port} in use, trying next.`)
        continue
      }
      throw error
    }
  }
  throw new Error(`All MCP ports ${MCP_DEFAULT_PORT}–${MCP_DEFAULT_PORT + MCP_PORT_ATTEMPTS - 1} occupied`)
}

function stopMcpServer(): Promise<void> {
  return new Promise((resolve) => {
    activePort = 0
    actionRouter = null
    if (!server) { resolve(); return }
    server.close(() => {
      server = null
      logger.info("MCP HTTP server stopped.")
      resolve()
    })
  })
}

function getMcpServerPort(): number {
  return activePort
}

function isMcpServerRunning(): boolean {
  return activePort > 0 && server !== null
}

function getMcpServerUrl(): string {
  return activePort > 0 ? `http://127.0.0.1:${activePort}/mcp` : ""
}

export { startMcpServer, stopMcpServer, getMcpServerPort, isMcpServerRunning, getMcpServerUrl }
