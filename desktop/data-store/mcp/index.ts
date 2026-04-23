#!/usr/bin/env node

const [major] = process.versions.node.split(".").map(Number)
if (major < 18) {
  process.stderr.write(`Error: Synapse MCP server requires Node.js >= 18.0.0 (current: ${process.versions.node})\n`)
  process.exit(1)
}

import { apiCall, isAppRunning, readServerInfo, type ServerInfo } from "../shared/resolve-user-data"
import { createInterface } from "node:readline"

type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: Record<string, unknown>
}

type McpTool = {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
}

const TOOLS: McpTool[] = [
  {
    name: "list_tables",
    description: "List all user tables in the data store",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_table",
    description: "Create a new table",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Table name" },
        columns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["TEXT", "INTEGER", "REAL", "BLOB", "JSON"] },
            },
            required: ["name", "type"],
          },
          description: "Column definitions",
        },
        description: { type: "string", description: "Optional table description" },
      },
      required: ["name", "columns"],
    },
  },
  {
    name: "drop_table",
    description: "Drop a table and all its data",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Table name" } },
      required: ["name"],
    },
  },
  {
    name: "describe_table",
    description: "Get table schema and metadata",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Table name" } },
      required: ["name"],
    },
  },
  {
    name: "add_column",
    description: "Add a column to an existing table",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        column: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["TEXT", "INTEGER", "REAL", "BLOB", "JSON"] },
            default: { description: "Default value for the column" },
          },
          required: ["name", "type"],
        },
      },
      required: ["table", "column"],
    },
  },
  {
    name: "insert",
    description: "Insert a single row",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        data: { type: "object", description: "Row data as key-value pairs" },
      },
      required: ["table", "data"],
    },
  },
  {
    name: "batch_insert",
    description: "Insert multiple rows in a single transaction",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        rows: { type: "array", items: { type: "object" }, description: "Array of row data" },
      },
      required: ["table", "rows"],
    },
  },
  {
    name: "query",
    description: "Query rows from a table with optional filtering, sorting, and pagination",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        where: {
          description: "Filter conditions (object for equality, array for expressions)",
          oneOf: [
            { type: "object", description: "Equality filter: { column: value }" },
            {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  op: { type: "string", enum: ["=", "!=", ">", "<", ">=", "<=", "LIKE"] },
                  value: {},
                },
                required: ["field", "op", "value"],
              },
              description: "Expression filter: [{ field, op, value }]",
            },
          ],
        },
        orderBy: {
          description: "Sort order (string or {field, dir})",
          oneOf: [
            { type: "string", description: "Column name (ascending)" },
            {
              type: "object",
              properties: {
                field: { type: "string" },
                dir: { type: "string", enum: ["asc", "desc"] },
              },
              required: ["field", "dir"],
            },
          ],
        },
        limit: { type: "number", description: "Max rows to return (default 100)" },
        offset: { type: "number", description: "Number of rows to skip" },
      },
      required: ["table"],
    },
  },
  {
    name: "update",
    description: "Update a row by id (partial update)",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        id: { type: "number", description: "Row id" },
        data: { type: "object", description: "Fields to update" },
      },
      required: ["table", "id", "data"],
    },
  },
  {
    name: "delete",
    description: "Delete a row by id",
    inputSchema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        id: { type: "number", description: "Row id" },
      },
      required: ["table", "id"],
    },
  },
  {
    name: "raw_sql",
    description: "Execute raw SQL (cannot access system tables or use ATTACH/DETACH)",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL statement" },
        params: { type: "array", description: "Bind parameters" },
      },
      required: ["sql"],
    },
  },
]

const ACTION_MAP: Record<string, string> = {
  list_tables: "listTables",
  create_table: "createTable",
  drop_table: "dropTable",
  describe_table: "describeTable",
  add_column: "addColumn",
  insert: "insert",
  batch_insert: "batchInsert",
  query: "query",
  update: "update",
  delete: "delete",
  raw_sql: "rawSQL",
}

function sendResponse(id: number | string, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result })
  process.stdout.write(msg + "\n")
}

function sendError(id: number | string | null, code: number, message: string): void {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })
  process.stdout.write(msg + "\n")
}

let serverInfo: ServerInfo | null = null

function getServerInfo(): ServerInfo {
  if (serverInfo) {
    if (!isAppRunning(serverInfo.pid)) {
      serverInfo = null
    }
  }
  if (!serverInfo) {
    serverInfo = readServerInfo()
    if (!isAppRunning(serverInfo.pid)) {
      serverInfo = null
      throw new Error("Synapse app is not running")
    }
  }
  return serverInfo
}

function clearServerInfoCache(): void {
  serverInfo = null
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const { id, method } = request

  if (request.jsonrpc !== "2.0" || typeof method !== "string") {
    sendError(id ?? null, -32600, "Invalid Request: missing jsonrpc 2.0 or method")
    return
  }

  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "synapse-data", version: "1.0.0" },
    })
    return
  }

  if (method === "notifications/initialized") {
    return
  }

  if (method === "tools/list") {
    sendResponse(id, { tools: TOOLS })
    return
  }

  if (method === "tools/call") {
    const params = request.params
    if (!params || typeof params !== "object") {
      sendResponse(id, {
        content: [{ type: "text", text: "Error: missing params" }],
        isError: true,
      })
      return
    }
    const toolName = (params as { name: string }).name
    const toolArgs = (params as { arguments?: Record<string, unknown> }).arguments ?? {}
    const action = ACTION_MAP[toolName]

    if (!action) {
      sendResponse(id, {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      })
      return
    }

    try {
      const info = getServerInfo()
      const result = await apiCall(info, action, toolArgs)
      sendResponse(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      })
    } catch (error) {
      clearServerInfoCache()
      sendResponse(id, {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      })
    }
    return
  }

  sendError(id, -32601, `Method not found: ${method}`)
}

const rl = createInterface({ input: process.stdin })

rl.on("line", (line) => {
  if (!line.trim()) return
  try {
    const request = JSON.parse(line) as JsonRpcRequest
    handleRequest(request).catch((error) => {
      sendError(request.id ?? null, -32603, `Internal error: ${(error as Error).message}`)
    })
  } catch {
    sendError(null, -32700, "Parse error")
  }
})
