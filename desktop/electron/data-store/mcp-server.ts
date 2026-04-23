import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { dataStoreService } from "./service"
import { createMainLogger } from "../services/log-store"
import type { DataStoreQueryParams } from "./types"

const logger = createMainLogger("data-store.mcp-server")

const MCP_DEFAULT_PORT = 23578
const MCP_PORT_ATTEMPTS = 5
const MAX_BODY_SIZE = 1024 * 1024

let server: Server | null = null
let activePort = 0

type JsonRpcRequest = {
  jsonrpc: "2.0"
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

type TableInfo = { name: string; description: string; rowCount: number }
type ColumnInfo = { name: string; type: string; primaryKey: boolean; description: string; enumValues?: string[] }
type TableSchema = TableInfo & { columns: ColumnInfo[] }

type McpTool = {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
}

// --- Tool definitions (ported from desktop/data-store/mcp/index.ts) ---

function buildTableSummary(schemas: TableSchema[]): string {
  if (schemas.length === 0) return "\n\nNo tables exist yet."
  const lines = ["\n\nAvailable tables:"]
  for (const t of schemas) {
    const desc = t.description ? ` — ${t.description}` : ""
    lines.push(`\n- ${t.name} (${t.rowCount} rows)${desc}`)
    for (const c of t.columns) {
      const cdesc = c.description ? ` — ${c.description}` : ""
      const pk = c.primaryKey ? " [PK]" : ""
      const enumSuffix = c.enumValues && c.enumValues.length > 0 ? ` [${c.enumValues.join(", ")}]` : ""
      lines.push(`    ${c.name}: ${c.type}${pk}${enumSuffix}${cdesc}`)
    }
  }
  return lines.join("\n")
}

function fetchTableSchemas(): TableSchema[] {
  const tables = dataStoreService.listTables() as TableInfo[]
  if (tables.length === 0) return []

  const schemas: TableSchema[] = []
  for (const t of tables) {
    try {
      schemas.push(dataStoreService.describeTable(t.name) as TableSchema)
    } catch {
      schemas.push({ ...t, columns: [] })
    }
  }
  return schemas
}

function buildTools(schemas: TableSchema[]): McpTool[] {
  const summary = buildTableSummary(schemas)
  const tableNames = schemas.map((t) => t.name)
  const tableNameProp: Record<string, unknown> = tableNames.length > 0
    ? { type: "string", description: "Table name", enum: tableNames }
    : { type: "string", description: "Table name" }

  return [
    {
      name: "list_tables",
      description: "List all user tables in the data store. Returns name, description, rowCount, createdAt, updatedAt for each table." + summary,
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "create_table",
      description: "Create a new table. System columns 'id' (auto-increment primary key), 'created_at' and 'updated_at' (ISO timestamps, auto-managed) are added automatically — do not include them in columns. Column types: TEXT, INTEGER, REAL, BLOB, DATE (YYYY-MM-DD), DATETIME (YYYY-MM-DD HH:mm:ss), BOOLEAN (true/false, stored as 0/1), JSON (objects/arrays, auto-serialized), ENUM (single-select, requires enumValues array), MULTI_ENUM (multi-select, requires enumValues array, value is a string array). Naming rules: must start with a letter, only letters/digits/underscores, cannot start with '_'. At least one column required.",
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
                type: { type: "string", enum: ["TEXT", "INTEGER", "REAL", "BLOB", "JSON", "DATE", "DATETIME", "BOOLEAN", "ENUM", "MULTI_ENUM"] },
                description: { type: "string", description: "Column description (helps AI understand the column's purpose)" },
                enumValues: { type: "array", items: { type: "string" }, description: "Required for ENUM/MULTI_ENUM type: list of allowed values" },
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
      description: "Drop a table and all its data. This action is irreversible.",
      inputSchema: { type: "object", properties: { name: tableNameProp }, required: ["name"] },
    },
    {
      name: "describe_table",
      description: "Get table schema and metadata. Returns columns (name, type, primaryKey, system, description, enumValues), rowCount, description, createdAt, updatedAt.",
      inputSchema: { type: "object", properties: { name: tableNameProp }, required: ["name"] },
    },
    {
      name: "add_column",
      description: "Add a column to an existing table. Column types: TEXT, INTEGER, REAL, BLOB, DATE (YYYY-MM-DD), DATETIME (YYYY-MM-DD HH:mm:ss), BOOLEAN (true/false), JSON, ENUM (single-select, requires enumValues), MULTI_ENUM (multi-select, requires enumValues). Column name: must start with a letter, only letters/digits/underscores, cannot be 'id' or start with '_'. Supports optional default value.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          column: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["TEXT", "INTEGER", "REAL", "BLOB", "JSON", "DATE", "DATETIME", "BOOLEAN", "ENUM", "MULTI_ENUM"] },
              default: { description: "Default value for the column" },
              description: { type: "string", description: "Column description" },
              enumValues: { type: "array", items: { type: "string" }, description: "Required for ENUM/MULTI_ENUM type: list of allowed values" },
            },
            required: ["name", "type"],
          },
        },
        required: ["table", "column"],
      },
    },
    {
      name: "update_column_description",
      description: "Update the description metadata of a column. Does not change the column type or data.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          column: { type: "string", description: "Column name" },
          description: { type: "string", description: "New column description" },
        },
        required: ["table", "column", "description"],
      },
    },
    {
      name: "update_column_enum_values",
      description: "Update the allowed values for an ENUM or MULTI_ENUM column. Replaces the entire list. At least one value required.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          column: { type: "string", description: "ENUM or MULTI_ENUM column name" },
          values: { type: "array", items: { type: "string" }, description: "New list of allowed values" },
        },
        required: ["table", "column", "values"],
      },
    },
    {
      name: "insert",
      description: "Insert a single row. Returns { id } of the new row. System columns 'id', 'created_at', 'updated_at' are auto-managed — do not include them. Value formats — DATE: 'YYYY-MM-DD', DATETIME: 'YYYY-MM-DD HH:mm:ss', BOOLEAN: true/false (stored as 0/1), JSON: pass object/array (auto-serialized), ENUM: must match one of the allowed values, MULTI_ENUM: pass a string array where each element matches an allowed value." + summary,
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          data: { type: "object", description: "Row data as key-value pairs" },
        },
        required: ["table", "data"],
      },
    },
    {
      name: "batch_insert",
      description: "Insert multiple rows in a single transaction. Returns { ids } array. System columns 'id', 'created_at', 'updated_at' are auto-managed — do not include them. Same value format rules as insert: DATE 'YYYY-MM-DD', DATETIME 'YYYY-MM-DD HH:mm:ss', BOOLEAN true/false, JSON as object/array, ENUM must match allowed values, MULTI_ENUM pass string array." + summary,
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          rows: { type: "array", items: { type: "object" }, description: "Array of row data" },
        },
        required: ["table", "rows"],
      },
    },
    {
      name: "query",
      description: "Query rows from a table with optional filtering, sorting, and pagination. Returns { rows, total }. WHERE supports two forms: object { column: value } for equality, or array [{ field, op, value }] with operators =, !=, >, <, >=, <=, LIKE. OrderBy: string (column name, ascending) or { field, dir: 'asc'|'desc' }. Default limit: 100. JSON and MULTI_ENUM columns are auto-parsed, BOOLEAN columns return true/false." + summary,
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
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
                properties: { field: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } },
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
      description: "Update a row by id (partial update). Returns { affected } count. The 'updated_at' column is auto-updated — do not include it. Same value format rules as insert: DATE 'YYYY-MM-DD', DATETIME 'YYYY-MM-DD HH:mm:ss', BOOLEAN true/false, JSON as object/array, ENUM must match allowed values, MULTI_ENUM pass string array." + summary,
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          id: { type: "number", description: "Row id" },
          data: { type: "object", description: "Fields to update" },
        },
        required: ["table", "id", "data"],
      },
    },
    {
      name: "delete",
      description: "Delete a row by id. Returns { affected } count (0 if row not found).",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          id: { type: "number", description: "Row id" },
        },
        required: ["table", "id"],
      },
    },
    {
      name: "raw_sql",
      description: "Execute raw SQL. Cannot access system tables (prefixed with '_') or use ATTACH/DETACH. SELECT/PRAGMA/EXPLAIN returns { rows }. INSERT/UPDATE/DELETE returns { changes, lastInsertRowid }. DDL (CREATE/DROP/ALTER TABLE) auto-syncs metadata." + summary,
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
}

const ACTION_MAP: Record<string, (args: Record<string, unknown>) => unknown> = {
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
  raw_sql: (args) => {
    const result = dataStoreService.rawSQL(args.sql as string, args.params as unknown[] | undefined)
    if (result.rows) return { ok: true, data: { rows: result.rows } }
    return { ok: true, data: { changes: result.changes, lastInsertRowid: result.lastInsertRowid } }
  },
}

// --- JSON-RPC handling ---

function sendJsonRpc(res: ServerResponse, id: number | string | null, result: unknown): void {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result })
  res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) })
  res.end(body)
}

function sendJsonRpcError(res: ServerResponse, id: number | string | null, code: number, message: string): void {
  const body = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })
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

function handleMcpRequest(req: JsonRpcRequest, res: ServerResponse): void {
  const { method, id } = req

  if (method === "initialize") {
    sendJsonRpc(res, id ?? null, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "synapse-data", version: "1.0.0" },
    })
    return
  }

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    res.writeHead(204)
    res.end()
    return
  }

  if (method === "ping") {
    sendJsonRpc(res, id ?? null, {})
    return
  }

  if (method === "tools/list") {
    let tools: McpTool[]
    try {
      tools = buildTools(fetchTableSchemas())
    } catch {
      tools = buildTools([])
    }
    sendJsonRpc(res, id ?? null, { tools })
    return
  }

  if (method === "tools/call") {
    const params = req.params
    if (!params || typeof params !== "object") {
      sendJsonRpc(res, id ?? null, { content: [{ type: "text", text: "Error: missing params" }], isError: true })
      return
    }
    const toolName = (params as { name: string }).name
    const toolArgs = (params as { arguments?: Record<string, unknown> }).arguments ?? {}
    const handler = ACTION_MAP[toolName]

    if (!handler) {
      sendJsonRpc(res, id ?? null, { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true })
      return
    }

    try {
      const result = handler(toolArgs)
      sendJsonRpc(res, id ?? null, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] })
    } catch (error) {
      sendJsonRpc(res, id ?? null, {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      })
    }
    return
  }

  sendJsonRpcError(res, id ?? null, -32601, `Method not found: ${method}`)
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
    sendJsonRpcError(res, null, -32700, "Parse error")
    return
  }

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    sendJsonRpcError(res, body.id ?? null, -32600, "Invalid Request")
    return
  }

  handleMcpRequest(body, res)
}

// --- Server lifecycle ---

function tryListen(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      handleRequest(req, res).catch((error) => {
        logger.error("Unhandled MCP HTTP error.", { error })
        res.writeHead(500)
        res.end()
      })
    })

    s.on("error", reject)

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
