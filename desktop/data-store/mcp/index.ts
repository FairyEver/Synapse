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

// Tool schemas are intentionally stateless: they describe capability, never runtime state.
// Clients discover which tables exist by calling list_tables, and inspect column/enum details by calling describe_table.
// This ensures the schema never goes stale after DDL operations, and keeps the contract valid on strict MCP clients (e.g. Codex) that enforce inputSchema enums client-side.

const tableNameProp: Record<string, unknown> = {
  type: "string",
  description: "Table name. If you do not know which tables exist, call list_tables first.",
}

function buildTools(): McpTool[] {
  return [
    {
      name: "list_tables",
      description: "List all user tables in the data store. Returns name, description, rowCount, createdAt, updatedAt for each table. Call this whenever you are unsure which tables currently exist.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "create_table",
      description: "Create a new table. READ THE TYPE SELECTION RULES BELOW BEFORE choosing column types — this store ships with specialized types (ENUM / MULTI_ENUM / BOOLEAN / DATE / DATETIME) that you MUST prefer over plain SQL types when the user's intent matches. Falling back to TEXT / INTEGER / JSON is almost always wrong for typed intents.\n\nTYPE SELECTION RULES (walk top-down; pick the FIRST matching rule, not the closest SQL analog):\n1. Single-choice from a fixed value set (单选枚举 / status / priority / role / 级别) → ENUM with enumValues. Do NOT use TEXT.\n2. Multi-select from a fixed value set (多选枚举 / tags / categories / 分类 / labels) → MULTI_ENUM with enumValues. Values are stored and returned as string arrays. Do NOT use JSON or TEXT.\n3. True/false (布尔 / 是否 / is- / has-) → BOOLEAN. Do NOT use INTEGER.\n4. Calendar date (YYYY-MM-DD) → DATE. Timestamp (YYYY-MM-DD HH:mm:ss) → DATETIME.\n5. Free-form object/array WITHOUT a fixed value set (arbitrary config, nested data) → JSON.\n6. Arbitrary scalar → TEXT / INTEGER / REAL / BLOB.\n\nEXAMPLE — User says: '字段：备注(remark TEXT)、分类(多选枚举, 公司/个人/生活/学习)、优先级(单选枚举, 高/中/低)、是否完成(布尔)'. Correct columns: [{name:'remark',type:'TEXT'},{name:'category',type:'MULTI_ENUM',enumValues:['公司','个人','生活','学习']},{name:'priority',type:'ENUM',enumValues:['高','中','低']},{name:'done',type:'BOOLEAN'}]. WRONG would be category=JSON, priority=TEXT, or done=INTEGER.\n\nSystem columns 'id' (auto-increment primary key), 'created_at', 'updated_at' (ISO timestamps) are added automatically — do not include them. Naming: must start with a letter, only letters/digits/underscores, cannot start with '_'. At least one column required. Full type list: TEXT, INTEGER, REAL, BLOB, DATE, DATETIME, BOOLEAN, JSON, ENUM, MULTI_ENUM.",
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
                type: {
                  type: "string",
                  enum: ["TEXT", "INTEGER", "REAL", "BLOB", "JSON", "DATE", "DATETIME", "BOOLEAN", "ENUM", "MULTI_ENUM"],
                  description: "Pick by user intent, not by closest SQL analog. Single-choice with fixed values (单选枚举) → ENUM (NOT TEXT). Multi-select with fixed values (多选枚举 / tags / categories / 分类) → MULTI_ENUM (NOT JSON, NOT TEXT). True/false (布尔) → BOOLEAN (NOT INTEGER). Calendar date → DATE. Timestamp → DATETIME. Free-form object/array without a fixed value set → JSON. See the tool description for the full rules.",
                },
                description: { type: "string", description: "Column description (helps AI understand the column's purpose)" },
                enumValues: {
                  type: "array",
                  items: { type: "string" },
                  description: "REQUIRED when type is ENUM or MULTI_ENUM. List of allowed values. If the user described a fixed set of choices, the correct type is ENUM (single) or MULTI_ENUM (multi) — never TEXT or JSON.",
                },
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
      description: "Add a column to an existing table. Apply the SAME TYPE SELECTION RULES as create_table — prefer specialized types over plain SQL analogs when intent matches.\n\nTYPE SELECTION RULES (pick the FIRST matching rule):\n1. Single-choice from a fixed value set (单选枚举 / status / priority / role) → ENUM with enumValues. Do NOT use TEXT.\n2. Multi-select from a fixed value set (多选枚举 / tags / categories / 分类) → MULTI_ENUM with enumValues. Do NOT use JSON or TEXT.\n3. True/false (布尔 / 是否) → BOOLEAN. Do NOT use INTEGER.\n4. Calendar date → DATE (YYYY-MM-DD). Timestamp → DATETIME (YYYY-MM-DD HH:mm:ss).\n5. Free-form object/array WITHOUT a fixed value set → JSON.\n6. Arbitrary scalar → TEXT / INTEGER / REAL / BLOB.\n\nColumn name rules: must start with a letter, only letters/digits/underscores, cannot be 'id' or start with '_'. Supports optional default value. Full type list: TEXT, INTEGER, REAL, BLOB, DATE, DATETIME, BOOLEAN, JSON, ENUM, MULTI_ENUM.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          column: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: {
                type: "string",
                enum: ["TEXT", "INTEGER", "REAL", "BLOB", "JSON", "DATE", "DATETIME", "BOOLEAN", "ENUM", "MULTI_ENUM"],
                description: "Pick by user intent, not by closest SQL analog. Single-choice with fixed values (单选枚举) → ENUM (NOT TEXT). Multi-select with fixed values (多选枚举 / tags / categories / 分类) → MULTI_ENUM (NOT JSON, NOT TEXT). True/false (布尔) → BOOLEAN (NOT INTEGER). See the tool description for the full rules.",
              },
              default: { description: "Default value for the column" },
              description: { type: "string", description: "Column description" },
              enumValues: {
                type: "array",
                items: { type: "string" },
                description: "REQUIRED when type is ENUM or MULTI_ENUM. List of allowed values. If the user described a fixed set of choices, the correct type is ENUM (single) or MULTI_ENUM (multi) — never TEXT or JSON.",
              },
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
      description: "Insert a single row. Returns { id } of the new row. System columns 'id', 'created_at', 'updated_at' are auto-managed — do not include them. Value formats — DATE: 'YYYY-MM-DD', DATETIME: 'YYYY-MM-DD HH:mm:ss', BOOLEAN: true/false (stored as 0/1), JSON: pass object/array (auto-serialized), ENUM: must match one of the allowed values, MULTI_ENUM: pass a string array where each element matches an allowed value. If you do not know the table's columns or enum values, call describe_table first.",
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
      description: "Insert multiple rows in a single transaction. Returns { ids } array. System columns 'id', 'created_at', 'updated_at' are auto-managed — do not include them. Same value format rules as insert: DATE 'YYYY-MM-DD', DATETIME 'YYYY-MM-DD HH:mm:ss', BOOLEAN true/false, JSON as object/array, ENUM must match allowed values, MULTI_ENUM pass string array. If you do not know the table's columns or enum values, call describe_table first.",
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
      description: "Query rows from a table with optional filtering, sorting, and pagination. Returns { rows, total }. WHERE supports two forms: object { column: value } for equality, or array [{ field, op, value }] with operators =, !=, >, <, >=, <=, LIKE, CONTAINS. CONTAINS is only valid on MULTI_ENUM columns and matches rows whose array contains the given value, e.g. { field: 'category', op: 'CONTAINS', value: '公司' }. OrderBy: string (column name, ascending) or { field, dir: 'asc'|'desc' }. Default limit: 100. JSON and MULTI_ENUM columns are auto-parsed, BOOLEAN columns return true/false. If you do not know the table's columns, call describe_table first.",
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
                    op: { type: "string", enum: ["=", "!=", ">", "<", ">=", "<=", "LIKE", "CONTAINS"] },
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
      description: "Update a row by id (partial update). Returns { affected } count. The 'updated_at' column is auto-updated — do not include it. Same value format rules as insert: DATE 'YYYY-MM-DD', DATETIME 'YYYY-MM-DD HH:mm:ss', BOOLEAN true/false, JSON as object/array, ENUM must match allowed values, MULTI_ENUM pass string array. If you do not know the table's columns or enum values, call describe_table first.",
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
      name: "update_where",
      description: "Update every row matching a where clause. Returns { affected, ids } — count and the ids of updated rows. 'where' is required and must be non-empty; for a single row by id use 'update' instead. The 'updated_at' column is auto-managed — do not include it. Same value format rules as insert: DATE 'YYYY-MM-DD', DATETIME 'YYYY-MM-DD HH:mm:ss', BOOLEAN true/false, JSON as object/array, ENUM must match allowed values, MULTI_ENUM pass string array. 'where' supports the same shape as query's where, including CONTAINS for MULTI_ENUM columns. If you do not know the table's columns or enum values, call describe_table first.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          where: {
            description: "Non-empty filter (object for equality, array for expressions)",
            oneOf: [
              { type: "object", description: "Equality filter: { column: value }" },
              {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string" },
                    op: { type: "string", enum: ["=", "!=", ">", "<", ">=", "<=", "LIKE", "CONTAINS"] },
                    value: {},
                  },
                  required: ["field", "op", "value"],
                },
                description: "Expression filter: [{ field, op, value }]",
              },
            ],
          },
          data: { type: "object", description: "Fields to update (partial)" },
        },
        required: ["table", "where", "data"],
      },
    },
    {
      name: "delete_where",
      description: "Delete every row matching a where clause. Returns { affected, ids } — count and the ids of deleted rows. 'where' is required and must be non-empty; for a single row by id use 'delete' instead. To clear all rows of a table, drop and recreate it. 'where' supports the same shape as query's where, including CONTAINS for MULTI_ENUM columns. If you do not know the table's columns, call describe_table first.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          where: {
            description: "Non-empty filter (object for equality, array for expressions)",
            oneOf: [
              { type: "object", description: "Equality filter: { column: value }" },
              {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string" },
                    op: { type: "string", enum: ["=", "!=", ">", "<", ">=", "<=", "LIKE", "CONTAINS"] },
                    value: {},
                  },
                  required: ["field", "op", "value"],
                },
                description: "Expression filter: [{ field, op, value }]",
              },
            ],
          },
        },
        required: ["table", "where"],
      },
    },
    {
      name: "raw_sql",
      description: "Execute raw SQL. Cannot access system tables (prefixed with '_') or use ATTACH/DETACH. SELECT/PRAGMA/EXPLAIN returns { rows }. INSERT/UPDATE/DELETE returns { changes, lastInsertRowid }. DDL (CREATE/DROP/ALTER TABLE) auto-syncs metadata. Prefer structured tools over raw_sql when possible. If you need to inspect existing tables, call list_tables and describe_table first.",
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
  update_where: "updateWhere",
  delete_where: "deleteWhere",
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
    sendResponse(id, { tools: buildTools() })
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
