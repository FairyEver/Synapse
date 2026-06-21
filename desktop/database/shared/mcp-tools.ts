// Shared MCP tool definitions.
// Both the in-process HTTP MCP server (electron/database/mcp-server.ts) and
// the stdio MCP bridge (database/mcp/index.ts) import from this file, so the
// two surfaces can never drift.
//
// Tool schemas are intentionally stateless: they describe capability, never
// runtime state. Clients discover which tables exist by calling database_table_list,
// and inspect column choices by calling database_table_describe. This keeps the
// schema valid on strict MCP clients (e.g. Codex) that enforce inputSchema
// allowed values client-side, even after DDL operations.

import { buildMcpToolActions } from "./capability-registry"
import {
  DATABASE_OPERATION_LOG_LIST_DEFAULT_LIMIT,
  DATABASE_OPERATION_LOG_LIST_MAX_LIMIT,
  DATABASE_ROW_LIST_DEFAULT_LIMIT,
  DATABASE_ROW_LIST_MAX_LIMIT,
} from "./limits"

type McpTool = {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
}

const tableNameProp: Record<string, unknown> = {
  type: "string",
  description: "Existing table name. If the user did not provide an exact table name, call database_table_list first and use table.description to choose the relevant table. Call database_table_describe before writes or when you need columns, choices, or field meanings.",
}

const columnKindEnum = ["text", "integer", "decimal", "boolean", "date", "timestamp", "single_choice", "multi_choice", "json", "binary"] as const

const kindDescription = [
  "text           Free-form string",
  "integer        Whole number",
  "decimal        Fractional number",
  "boolean        true or false",
  "date           YYYY-MM-DD",
  "timestamp      ISO 8601 timestamp",
  "single_choice  One value from a fixed list; requires non-empty choices",
  "multi_choice   Multiple values from a fixed list; requires non-empty choices",
  "json           Free-form object or array (use only when value has no fixed structure)",
  "binary         Raw bytes",
].join("\n")

const whereConditionSchema = {
  type: "object",
  properties: {
    field: { type: "string", description: "Column name" },
    op: {
      type: "string",
      enum: ["=", "!=", ">", "<", ">=", "<=", "LIKE", "CONTAINS"],
      description: "Comparison operator. CONTAINS is only valid on multi_choice columns.",
    },
    value: { description: "Comparison value. For CONTAINS, pass one scalar item, not an array or object." },
  },
  required: ["field", "op", "value"],
}

const whereClauseSchema = {
  anyOf: [
    {
      type: "object",
      not: { required: ["combinator", "conditions"] },
      description: "Equality filter object. Each key becomes `column = value`, and multiple keys are combined with AND.",
    },
    {
      type: "array",
      items: whereConditionSchema,
      description: "Explicit filter expressions combined with AND: [{ field, op, value }].",
    },
    {
      type: "object",
      properties: {
        combinator: { type: "string", enum: ["all", "any"], description: "all combines conditions with AND; any combines them with OR." },
        conditions: { type: "array", minItems: 1, items: whereConditionSchema, description: "Filter expressions in this group." },
      },
      required: ["combinator", "conditions"],
      description: "Grouped filter object: { combinator: 'all'|'any', conditions: [...] }.",
    },
  ],
}

function buildTools(): McpTool[] {
  return [
    {
      name: "database_table_list",
      description: "List all user tables in the database. Use description to choose the relevant table when the user describes a purpose rather than an exact table name. Returns an array of { name, description, rowCount, createdAt, updatedAt }.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "database_table_create",
      description: `Create a user table with at least one column; system columns id, created_at, and updated_at are added automatically. Column kinds:\n${kindDescription}\nTable and column names must start with a letter, contain only letters, digits, or underscores, cannot start with _, and columns cannot be id, created_at, or updated_at. Provide a one-line description for each column to capture user intent.`,
      inputSchema: {
        type: "object",
        properties: {
          tableName: {
            type: "string",
            description: "New table name. Must start with a letter, use only letters, digits, or underscores, and not start with _.",
          },
          columns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Column name. Must start with a letter, use only letters, digits, or underscores, and not be id, created_at, or updated_at.",
                },
                kind: {
                  type: "string",
                  enum: columnKindEnum,
                  description: "Choose by user intent, not by storage format.",
                },
                description: {
                  type: "string",
                  description: "Recommended one-line description of the column's intent. Stored in metadata and returned by database_table_describe.",
                },
                choices: {
                  type: "array",
                  items: { type: "string" },
                  description: "Required for single_choice or multi_choice. Allowed values for the column.",
                },
              },
              required: ["name", "kind"],
            },
            description: "User-defined columns to create. Provide at least one; system columns are added automatically.",
          },
          description: {
            type: "string",
            description: "Optional table description stored in metadata and returned by database_table_list and database_table_describe.",
          },
        },
        required: ["tableName", "columns"],
      },
    },
    {
      name: "database_table_delete",
      description: "Drop a user table and all of its rows and metadata. This action is irreversible.",
      inputSchema: { type: "object", properties: { tableName: tableNameProp }, required: ["tableName"] },
    },
    {
      name: "database_table_describe",
      description: "Return table schema and metadata as { name, description, columns, rowCount, createdAt, updatedAt }. Call this before inserts, updates, filters, or schema-sensitive operations. Each column includes { name, kind, choices?, description?, primaryKey?, system? }.",
      inputSchema: { type: "object", properties: { tableName: tableNameProp }, required: ["tableName"] },
    },
    {
      name: "database_overview_get",
      description: "Return an overview of all user tables, table descriptions, row counts, and column summaries. Use this first when the user asks broadly about available data.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "database_table_update",
      description: "Update the stored table description metadata. This keeps database_table_list and database_table_describe useful for agents without changing rows or columns.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          description: {
            type: "string",
            description: "New table description stored in metadata and returned by database_table_list and database_table_describe.",
          },
        },
        required: ["tableName", "description"],
      },
    },
    {
      name: "database_column_create",
      description: `Add one column to an existing table and update table metadata. Use the same kind rules as database_table_create:\n${kindDescription}\nColumn names must start with a letter, contain only letters, digits, or underscores, cannot start with _, and cannot be id, created_at, or updated_at. Defaults for multi_choice must be arrays, and choice defaults must already appear in choices. Provide a one-line description for the column to capture user intent.`,
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          column: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Column name. Must start with a letter, use only letters, digits, or underscores, and not be id, created_at, or updated_at.",
              },
              kind: {
                type: "string",
                enum: columnKindEnum,
                description: "Choose by user intent, not by storage format.",
              },
              default: {
                description: "Optional default value. multi_choice defaults must be arrays, and choice defaults must already exist in choices.",
              },
              description: {
                type: "string",
                description: "Recommended one-line description of the column's intent. Stored in metadata and returned by database_table_describe.",
              },
              choices: {
                type: "array",
                items: { type: "string" },
                description: "Required for single_choice or multi_choice. Allowed values for the column.",
              },
            },
            required: ["name", "kind"],
          },
        },
        required: ["tableName", "column"],
      },
    },
    {
      name: "database_column_update",
      description: "Update the stored description metadata for a user column. This does not change column kind or row data.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          columnName: { type: "string", description: "User column name" },
          description: { type: "string", description: "New description text stored in metadata" },
        },
        required: ["tableName", "columnName", "description"],
      },
    },
    {
      name: "database_choice_update",
      description: "Replace the choices metadata for a single_choice or multi_choice column. Requires at least one choice and rejects the change if existing rows contain values outside the new list.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          columnName: { type: "string", description: "single_choice or multi_choice column name" },
          choices: {
            type: "array",
            items: { type: "string" },
            description: "Replacement choices list. Must contain at least one string and remain compatible with existing rows.",
          },
        },
        required: ["tableName", "columnName", "choices"],
      },
    },
    {
      name: "database_choice_usage_get",
      description: "Return usage counts for every configured choice in a single_choice or multi_choice column. Use before database_choice_update when you need to know which choices are currently used by rows.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          columnName: { type: "string", description: "single_choice or multi_choice column name" },
        },
        required: ["tableName", "columnName"],
      },
    },
    {
      name: "database_row_create",
      description: "Insert one row and return { id }. Do not send system columns id, created_at, or updated_at; boolean values accept true or false; date values expect YYYY-MM-DD; timestamp values expect ISO 8601 (e.g. 2026-04-24T15:30:00); single_choice values must be in the column's choices; multi_choice values expect an array of strings, each in the column's choices; json values accept any object or array. Call database_table_describe first if you do not know the column set or choices.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          data: {
            type: "object",
            description: "Row object keyed by column name. Omit id, created_at, and updated_at; multi_choice values should be arrays, and json values may be objects or arrays.",
          },
        },
        required: ["tableName", "data"],
      },
    },
    {
      name: "database_rows_create",
      description: "Insert multiple rows in one transaction and return { ids }. Do not send system columns id, created_at, or updated_at; boolean values accept true or false; date values expect YYYY-MM-DD; timestamp values expect ISO 8601 (e.g. 2026-04-24T15:30:00); single_choice values must be in the column's choices; multi_choice values expect an array of strings, each in the column's choices; json values accept any object or array. Call database_table_describe first if you do not know the column set or choices.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          rows: {
            type: "array",
            items: { type: "object" },
            description: "Array of row objects keyed by column name. Each row follows the same value rules as database_row_create.",
          },
        },
        required: ["tableName", "rows"],
      },
    },
    {
      name: "database_row_list",
      description: `Query rows with optional where, orderBy, limit, and offset, and return { rows, total }. where accepts an equality object { column: value }, an ANDed expression array [{ field, op, value }], or a group { combinator: 'all'|'any', conditions }; op is =, !=, >, <, >=, <=, LIKE, or CONTAINS, and CONTAINS only works on multi_choice columns with one scalar item. orderBy is either a column name for ascending sort or { field, dir: 'asc'|'desc' }, limit defaults to ${DATABASE_ROW_LIST_DEFAULT_LIMIT} and must be between 0 and ${DATABASE_ROW_LIST_MAX_LIMIT}, offset defaults to 0, json and multi_choice values are parsed on read, and boolean values are returned as true or false.`,
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          where: {
            description: "Optional filter. Object form uses equality on each key and ANDs them together; array form uses explicit expressions.",
            ...whereClauseSchema,
          },
          orderBy: {
            description: "Optional sort order: a column name for ascending sort, or { field, dir }.",
            oneOf: [
              { type: "string", description: "Column name (ascending)" },
              {
                type: "object",
                properties: {
                  field: { type: "string", description: "Column name" },
                  dir: { type: "string", enum: ["asc", "desc"], description: "Sort direction" },
                },
                required: ["field", "dir"],
              },
            ],
          },
          limit: {
            type: "integer",
            minimum: 0,
            maximum: DATABASE_ROW_LIST_MAX_LIMIT,
            description: `Maximum rows to return. Defaults to ${DATABASE_ROW_LIST_DEFAULT_LIMIT}.`,
          },
          offset: {
            type: "integer",
            minimum: 0,
            description: "Rows to skip before returning results. Defaults to 0.",
          },
        },
        required: ["tableName"],
      },
    },
    {
      name: "database_row_update",
      description: "Partially update one row by id and return { affected }. Do not send updated_at; the service writes a fresh ISO timestamp automatically, and the same value rules as database_row_create apply. Call database_table_describe first if you do not know the column set or choices.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          rowId: { type: "number", description: "Row id" },
          data: {
            type: "object",
            minProperties: 1,
            description: "Partial update object keyed by column name. Include at least one non-system column; omit created_at and updated_at. multi_choice values should be arrays, and json values may be objects or arrays.",
          },
        },
        required: ["tableName", "rowId", "data"],
      },
    },
    {
      name: "database_row_delete",
      description: "Delete one row by id and return { affected }, where 0 means no row matched.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          rowId: { type: "number", description: "Row id" },
        },
        required: ["tableName", "rowId"],
      },
    },
    {
      name: "database_rows_update",
      description: "Partially update every row matching a non-empty where clause and return { affected, ids }. where uses the same shapes and operators as database_row_list, including CONTAINS for multi_choice columns, updated_at is rewritten automatically, and the same write-value rules as database_row_create apply. Use database_row_update for a single row by id.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          where: {
            description: "Required non-empty filter. Object form uses equality on each key and ANDs them together; array form uses explicit expressions.",
            ...whereClauseSchema,
          },
          data: {
            type: "object",
            minProperties: 1,
            description: "Partial update object keyed by column name. Include at least one non-system column; omit created_at and updated_at. multi_choice values should be arrays, and json values may be objects or arrays.",
          },
          dryRun: {
            type: "boolean",
            description: "When true, return affected ids without modifying rows.",
          },
        },
        required: ["tableName", "where", "data"],
      },
    },
    {
      name: "database_rows_delete",
      description: "Delete every row matching a non-empty where clause and return { affected, ids }. where uses the same shapes and operators as database_row_list, including CONTAINS for multi_choice columns. Use database_row_delete for a single row by id; to clear a whole table, use database_table_delete then database_table_create.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          where: {
            description: "Required non-empty filter. Object form uses equality on each key and ANDs them together; array form uses explicit expressions.",
            ...whereClauseSchema,
          },
          dryRun: {
            type: "boolean",
            description: "When true, return affected ids without modifying rows.",
          },
        },
        required: ["tableName", "where"],
      },
    },
    {
      name: "database_row_count",
      description: "Count rows in a table with an optional where clause and return { count }. where uses the same shapes and operators as database_row_list, including CONTAINS for multi_choice columns. Use this instead of database_row_list when you only need the number of matching rows.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          where: {
            description: "Optional filter. Object form uses equality on each key and ANDs them together; array form uses explicit expressions.",
            ...whereClauseSchema,
          },
        },
        required: ["tableName"],
      },
    },
    {
      name: "database_log_list",
      description: `Return recent Database mutation operations. Use this when the user asks what an Agent or MCP client recently changed. limit defaults to ${DATABASE_OPERATION_LOG_LIST_DEFAULT_LIMIT} and must be between 0 and ${DATABASE_OPERATION_LOG_LIST_MAX_LIMIT}.`,
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 0,
            maximum: DATABASE_OPERATION_LOG_LIST_MAX_LIMIT,
            description: `Maximum log entries to return. Defaults to ${DATABASE_OPERATION_LOG_LIST_DEFAULT_LIMIT}.`,
          },
        },
      },
    },
    {
      name: "database_table_rename",
      description: "Rename a table without changing its rows, system columns, or stored metadata. The target name must not already exist and must start with a letter, contain only letters, digits, or underscores, and not start with _.",
      inputSchema: {
        type: "object",
        properties: {
          fromTableName: { type: "string", description: "Current table name" },
          toTableName: {
            type: "string",
            description: "New table name. Must start with a letter, use only letters, digits, or underscores, and not start with _.",
          },
        },
        required: ["fromTableName", "toTableName"],
      },
    },
    {
      name: "database_column_rename",
      description: "Rename a user column without changing its data, description metadata, kind, or choices. The target column must not already exist, and both names follow the normal column rules: start with a letter, use only letters, digits, or underscores, cannot start with _, and cannot be id, created_at, or updated_at.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          fromColumnName: { type: "string", description: "Current user column name" },
          toColumnName: {
            type: "string",
            description: "New column name. Must start with a letter, use only letters, digits, or underscores, and not be id, created_at, or updated_at.",
          },
        },
        required: ["tableName", "fromColumnName", "toColumnName"],
      },
    },
    {
      name: "database_column_delete",
      description: "Drop one user column and all values stored in it. Cannot target id, created_at, or updated_at, and refuses to remove the last non-system column of a table.",
      inputSchema: {
        type: "object",
        properties: {
          tableName: tableNameProp,
          columnName: { type: "string", description: "User column name" },
        },
        required: ["tableName", "columnName"],
      },
    },
    {
      name: "database_sql_read",
      description: "Execute a read-only SQL statement with optional positional bind params. Allows SELECT, EXPLAIN, and read-only PRAGMA inspection. Prefer this over database_sql_execute for inspection and reporting. System tables such as _table_folders and _table_folder_members are blocked.",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "Read-only SQL statement" },
          params: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
                { type: "null" },
              ],
            },
            description: "Optional positional bind parameters",
          },
        },
        required: ["sql"],
      },
    },
    {
      name: "database_sql_execute",
      description: "Execute raw SQL with optional positional bind params. Prefer database_sql_read for inspection and structured tools for normal writes. Use only when the user explicitly needs SQL-level DDL/DML or advanced repair. System tables such as _table_folders and _table_folder_members, ATTACH or DETACH, mutating PRAGMA statements, and VACUUM INTO file writes are blocked.",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "SQL statement to execute" },
          params: {
            type: "array",
            items: {
              anyOf: [
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
                { type: "null" },
              ],
            },
            description: "Optional positional bind parameters for the prepared statement",
          },
        },
        required: ["sql"],
      },
    },
    {
      name: "database_folder_list",
      description: "List all table folders and their members. Returns an array of { id, name, sortOrder, members: [{ tableName, sortOrder }] }.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "database_folder_create",
      description: "Create a table folder. Folder names must be unique and non-empty.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Folder name. Must be unique and non-empty.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "database_folder_rename",
      description: "Rename a table folder. The new name must be unique and non-empty.",
      inputSchema: {
        type: "object",
        properties: {
          folderId: {
            type: "number",
            description: "Folder id",
          },
          name: {
            type: "string",
            description: "New folder name. Must be unique and non-empty.",
          },
        },
        required: ["folderId", "name"],
      },
    },
    {
      name: "database_folder_delete",
      description: "Delete a table folder. Tables inside the folder are moved to root (no longer in any folder).",
      inputSchema: {
        type: "object",
        properties: {
          folderId: {
            type: "number",
            description: "Folder id",
          },
        },
        required: ["folderId"],
      },
    },
    {
      name: "database_folder_reorder",
      description: "Reorder table folders. Pass folderIds in the desired order.",
      inputSchema: {
        type: "object",
        properties: {
          folderIds: {
            type: "array",
            items: { type: "number" },
            description: "Folder ids in desired order",
          },
        },
        required: ["folderIds"],
      },
    },
    {
      name: "database_table_move",
      description: "Move a table to a folder or to root. Call database_folder_list to see available folders. Omit folderId to move table to root (no folder).",
      inputSchema: {
        type: "object",
        properties: {
          tableName: {
            type: "string",
            description: "Existing table name. If the user did not provide an exact table name, call database_table_list first.",
          },
          folderId: {
            type: "number",
            description: "Optional folder id. Omit to move table to root (no folder).",
          },
        },
        required: ["tableName"],
      },
    },
  ]
}

// Maps MCP tool names (snake_case) to canonical action ids used by the
// in-process service, the HTTP JSON API (http-server.ts), and the stdio MCP
// bridge (which forwards to HTTP).
const DATABASE_MCP_TOOL_ACTIONS: Record<string, string> = buildMcpToolActions()
const MCP_TOOL_ACTIONS: Record<string, string> = DATABASE_MCP_TOOL_ACTIONS

export {
  buildTools,
  buildTools as buildDatabaseTools,
  DATABASE_MCP_TOOL_ACTIONS,
  MCP_TOOL_ACTIONS,
}
export type { McpTool }
