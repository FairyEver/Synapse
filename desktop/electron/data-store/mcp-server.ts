import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { dataStoreService } from "./service"
import { createMainLogger } from "../services/log-store"
import type { DataStoreQueryParams, DataStoreWhereClause } from "./types"
import {
  processMcpRequest,
  serializeJsonRpcPayload,
  type JsonRpcRequest,
  type McpRpcResponse,
} from "../../data-store/shared/mcp-rpc"

const logger = createMainLogger("data-store.mcp-server")

const MCP_DEFAULT_PORT = 23578
const MCP_PORT_ATTEMPTS = 5
const MAX_BODY_SIZE = 1024 * 1024
const SERVER_IDENTITY = { name: "synapse-data", version: "1.0.0" } as const

let server: Server | null = null
let activePort = 0

// Each tool forwards directly to the in-process data store service. Param
// shapes mirror the schema declared in data-store/shared/mcp-tools.ts.
const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => unknown> = {
  list_tables: () => ({ ok: true, data: dataStoreService.listTables() }),
  create_table: (args) => {
    dataStoreService.createTable(
      args.name as string,
      args.columns as { name: string; type: "TEXT" | "INTEGER" | "REAL" | "BLOB" | "JSON" | "DATE" | "DATETIME" | "BOOLEAN" | "ENUM" | "MULTI_ENUM"; enumValues?: string[] }[],
      args.description as string | undefined,
    )
    return { ok: true }
  },
  drop_table: (args) => { dataStoreService.dropTable(args.name as string); return { ok: true } },
  describe_table: (args) => ({ ok: true, data: dataStoreService.describeTable(args.name as string) }),
  add_column: (args) => {
    const table = (args.table ?? args.name) as string
    dataStoreService.addColumn(table, args.column as { name: string; type: "TEXT" | "INTEGER" | "REAL" | "BLOB" | "JSON" | "DATE" | "DATETIME" | "BOOLEAN" | "ENUM" | "MULTI_ENUM"; default?: unknown; description?: string; enumValues?: string[] })
    return { ok: true }
  },
  update_column_description: (args) => {
    dataStoreService.updateColumnDescription(args.table as string, args.column as string, args.description as string)
    return { ok: true }
  },
  update_column_enum_values: (args) => {
    dataStoreService.updateColumnEnumValues(args.table as string, args.column as string, args.values as string[])
    return { ok: true }
  },
  insert: (args) => {
    const result = dataStoreService.insert(args.table as string, args.data as Record<string, unknown>)
    return { ok: true, data: result, affected: 1 }
  },
  batch_insert: (args) => {
    const result = dataStoreService.batchInsert(args.table as string, args.rows as Record<string, unknown>[])
    return { ok: true, data: result, affected: result.ids.length }
  },
  query: (args) => {
    const result = dataStoreService.query(args as DataStoreQueryParams)
    return { ok: true, data: result.rows, total: result.total }
  },
  update: (args) => {
    const result = dataStoreService.update(args.table as string, args.id as number, args.data as Record<string, unknown>)
    return { ok: true, data: { id: args.id }, affected: result.affected }
  },
  delete: (args) => {
    const result = dataStoreService.delete(args.table as string, args.id as number)
    return { ok: true, data: { id: args.id }, affected: result.affected }
  },
  update_where: (args) => {
    const result = dataStoreService.updateWhere(
      args.table as string,
      args.where as DataStoreWhereClause,
      args.data as Record<string, unknown>,
    )
    return { ok: true, data: { ids: result.ids }, affected: result.affected }
  },
  delete_where: (args) => {
    const result = dataStoreService.deleteWhere(
      args.table as string,
      args.where as DataStoreWhereClause,
    )
    return { ok: true, data: { ids: result.ids }, affected: result.affected }
  },
  raw_sql: (args) => {
    const result = dataStoreService.rawSQL(args.sql as string, args.params as unknown[] | undefined)
    if (result.rows) return { ok: true, data: { rows: result.rows } }
    return { ok: true, data: { changes: result.changes, lastInsertRowid: result.lastInsertRowid } }
  },
}

async function executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const handler = TOOL_HANDLERS[toolName]
  if (!handler) throw new Error(`Unknown tool: ${toolName}`)
  return handler(args)
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

  const response = await processMcpRequest(body, SERVER_IDENTITY, executeTool)
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

async function startMcpServer(): Promise<number> {
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
