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

type TableInfo = { name: string; description: string; rowCount: number }
type ColumnInfo = { name: string; type: string; primaryKey: boolean; description: string; enumValues?: string[] }
type TableSchema = TableInfo & { columns: ColumnInfo[] }

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

async function fetchTableSchemas(info: ServerInfo): Promise<TableSchema[]> {
  const listResult = await apiCall(info, "listTables") as { data: TableInfo[] }
  const tables = listResult.data ?? []
  if (tables.length === 0) return []

  const schemas: TableSchema[] = []
  for (const t of tables) {
    try {
      const desc = await apiCall(info, "describeTable", { name: t.name }) as { data: TableSchema }
      schemas.push(desc.data)
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
      description: "Create a new table. System columns 'id' (auto-increment primary key), 'created_at' and 'updated_at' (ISO timestamps, auto-managed) are added automatically — do not include them in columns. Choose the column type by user intent, in this priority order: (1) fixed set of allowed values, single choice → ENUM (requires enumValues); (2) fixed set of allowed values, multi-select (e.g. tags, categories, 多选枚举) → MULTI_ENUM (requires enumValues; value is a string array) — do NOT use JSON for this case; (3) free-form object/array with no fixed value set → JSON; (4) plain scalars → TEXT / INTEGER / REAL / BLOB; (5) calendar date → DATE (YYYY-MM-DD); (6) timestamp → DATETIME (YYYY-MM-DD HH:mm:ss); (7) true/false → BOOLEAN (stored as 0/1). Full type list: TEXT, INTEGER, REAL, BLOB, DATE, DATETIME, BOOLEAN, JSON, ENUM, MULTI_ENUM. Naming rules: must start with a letter, only letters/digits/underscores, cannot start with '_'. At least one column required.",
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
      inputSchema: {
        type: "object",
        properties: { name: tableNameProp },
        required: ["name"],
      },
    },
    {
      name: "describe_table",
      description: "Get table schema and metadata. Returns columns (name, type, primaryKey, system, description, enumValues), rowCount, description, createdAt, updatedAt.",
      inputSchema: {
        type: "object",
        properties: { name: tableNameProp },
        required: ["name"],
      },
    },
    {
      name: "add_column",
      description: "Add a column to an existing table. Choose the column type by user intent, in this priority order: (1) fixed set of allowed values, single choice → ENUM (requires enumValues); (2) fixed set of allowed values, multi-select (e.g. tags, categories, 多选枚举) → MULTI_ENUM (requires enumValues; value is a string array) — do NOT use JSON for this case; (3) free-form object/array with no fixed value set → JSON; (4) plain scalars → TEXT / INTEGER / REAL / BLOB; (5) calendar date → DATE (YYYY-MM-DD); (6) timestamp → DATETIME (YYYY-MM-DD HH:mm:ss); (7) true/false → BOOLEAN (stored as 0/1). Full type list: TEXT, INTEGER, REAL, BLOB, DATE, DATETIME, BOOLEAN, JSON, ENUM, MULTI_ENUM. Column name: must start with a letter, only letters/digits/underscores, cannot be 'id' or start with '_'. Supports optional default value.",
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

const ACTION_MAP: Record<string, string> = {
  list_tables: "listTables",
  create_table: "createTable",
  drop_table: "dropTable",
  describe_table: "describeTable",
  add_column: "addColumn",
  update_column_description: "updateColumnDescription",
  update_column_enum_values: "updateColumnEnumValues",
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

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return
  }

  if (method === "ping") {
    sendResponse(id, {})
    return
  }

  if (method === "tools/list") {
    let tools: McpTool[]
    try {
      const info = getServerInfo()
      const schemas = await fetchTableSchemas(info)
      tools = buildTools(schemas)
    } catch {
      tools = buildTools([])
    }
    sendResponse(id, { tools })
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
