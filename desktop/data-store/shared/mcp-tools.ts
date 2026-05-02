// Shared MCP tool definitions.
// Both the in-process HTTP MCP server (electron/data-store/mcp-server.ts) and
// the stdio MCP bridge (data-store/mcp/index.ts) import from this file, so the
// two surfaces can never drift.
//
// Tool schemas are intentionally stateless: they describe capability, never
// runtime state. Clients discover which tables exist by calling list_tables,
// and inspect column choices by calling describe_table. This keeps the
// schema valid on strict MCP clients (e.g. Codex) that enforce inputSchema
// allowed values client-side, even after DDL operations.

import { buildMcpToolActions } from "./capability-registry"

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
  description: "Existing table name. If the user did not provide an exact table name, call list_tables first and use table.description to choose the relevant table. Call describe_table before writes or when you need columns, choices, or field meanings.",
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
        conditions: { type: "array", items: whereConditionSchema, description: "Filter expressions in this group." },
      },
      required: ["combinator", "conditions"],
      description: "Grouped filter object: { combinator: 'all'|'any', conditions: [...] }.",
    },
  ],
}

function buildTools(): McpTool[] {
  return [
    {
      name: "list_tables",
      description: "List all user tables in the data store. Use description to choose the relevant table when the user describes a purpose rather than an exact table name. Returns an array of { name, description, rowCount, createdAt, updatedAt }.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "create_table",
      description: `Create a user table with at least one column; system columns id, created_at, and updated_at are added automatically. Column kinds:\n${kindDescription}\nTable and column names must start with a letter, contain only letters, digits, or underscores, cannot start with _, and columns cannot be id, created_at, or updated_at. Provide a one-line description for each column to capture user intent.`,
      inputSchema: {
        type: "object",
        properties: {
          name: {
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
                  description: "Recommended one-line description of the column's intent. Stored in metadata and returned by describe_table.",
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
            description: "Optional table description stored in metadata and returned by list_tables and describe_table.",
          },
        },
        required: ["name", "columns"],
      },
    },
    {
      name: "drop_table",
      description: "Drop a user table and all of its rows and metadata. This action is irreversible.",
      inputSchema: { type: "object", properties: { name: tableNameProp }, required: ["name"] },
    },
    {
      name: "describe_table",
      description: "Return table schema and metadata as { name, description, columns, rowCount, createdAt, updatedAt }. Call this before inserts, updates, filters, or schema-sensitive operations. Each column includes { name, kind, choices?, description?, primaryKey?, system? }.",
      inputSchema: { type: "object", properties: { name: tableNameProp }, required: ["name"] },
    },
    {
      name: "database_overview",
      description: "Return an overview of all user tables, table descriptions, row counts, and column summaries. Use this first when the user asks broadly about available data.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "update_table_description",
      description: "Update the stored table description metadata. This keeps list_tables and describe_table useful for agents without changing rows or columns.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          description: {
            type: "string",
            description: "New table description stored in metadata and returned by list_tables and describe_table.",
          },
        },
        required: ["table", "description"],
      },
    },
    {
      name: "add_column",
      description: `Add one column to an existing table and update table metadata. Use the same kind rules as create_table:\n${kindDescription}\nColumn names must start with a letter, contain only letters, digits, or underscores, cannot start with _, and cannot be id, created_at, or updated_at. Defaults for multi_choice must be arrays, and choice defaults must already appear in choices. Provide a one-line description for the column to capture user intent.`,
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
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
                description: "Recommended one-line description of the column's intent. Stored in metadata and returned by describe_table.",
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
        required: ["table", "column"],
      },
    },
    {
      name: "update_column_description",
      description: "Update the stored description metadata for a user column. This does not change column kind or row data.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          column: { type: "string", description: "User column name" },
          description: { type: "string", description: "New description text stored in metadata" },
        },
        required: ["table", "column", "description"],
      },
    },
    {
      name: "update_column_choices",
      description: "Replace the choices metadata for a single_choice or multi_choice column. Requires at least one choice and rejects the change if existing rows contain values outside the new list.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          column: { type: "string", description: "single_choice or multi_choice column name" },
          choices: {
            type: "array",
            items: { type: "string" },
            description: "Replacement choices list. Must contain at least one string and remain compatible with existing rows.",
          },
        },
        required: ["table", "column", "choices"],
      },
    },
    {
      name: "get_column_choices_usage",
      description: "Return usage counts for every configured choice in a single_choice or multi_choice column. Use before update_column_choices when you need to know which choices are currently used by rows.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          column: { type: "string", description: "single_choice or multi_choice column name" },
        },
        required: ["table", "column"],
      },
    },
    {
      name: "insert",
      description: "Insert one row and return { id }. Do not send system columns id, created_at, or updated_at; boolean values accept true or false; date values expect YYYY-MM-DD; timestamp values expect ISO 8601 (e.g. 2026-04-24T15:30:00); single_choice values must be in the column's choices; multi_choice values expect an array of strings, each in the column's choices; json values accept any object or array. Call describe_table first if you do not know the column set or choices.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          data: {
            type: "object",
            description: "Row object keyed by column name. Omit id, created_at, and updated_at; multi_choice values should be arrays, and json values may be objects or arrays.",
          },
        },
        required: ["table", "data"],
      },
    },
    {
      name: "batch_insert",
      description: "Insert multiple rows in one transaction and return { ids }. Do not send system columns id, created_at, or updated_at; boolean values accept true or false; date values expect YYYY-MM-DD; timestamp values expect ISO 8601 (e.g. 2026-04-24T15:30:00); single_choice values must be in the column's choices; multi_choice values expect an array of strings, each in the column's choices; json values accept any object or array. Call describe_table first if you do not know the column set or choices.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          rows: {
            type: "array",
            items: { type: "object" },
            description: "Array of row objects keyed by column name. Each row follows the same value rules as insert.",
          },
        },
        required: ["table", "rows"],
      },
    },
    {
      name: "query",
      description: "Query rows with optional where, orderBy, limit, and offset, and return { rows, total }. where accepts an equality object { column: value }, an ANDed expression array [{ field, op, value }], or a group { combinator: 'all'|'any', conditions }; op is =, !=, >, <, >=, <=, LIKE, or CONTAINS, and CONTAINS only works on multi_choice columns with one scalar item. orderBy is either a column name for ascending sort or { field, dir: 'asc'|'desc' }, limit defaults to 100, offset defaults to 0, json and multi_choice values are parsed on read, and boolean values are returned as true or false.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
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
          limit: { type: "number", description: "Maximum rows to return. Defaults to 100." },
          offset: { type: "number", description: "Rows to skip before returning results. Defaults to 0." },
        },
        required: ["table"],
      },
    },
    {
      name: "update",
      description: "Partially update one row by id and return { affected }. Do not send updated_at; the service writes a fresh ISO timestamp automatically, and the same value rules as insert apply. Call describe_table first if you do not know the column set or choices.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          id: { type: "number", description: "Row id" },
          data: {
            type: "object",
            description: "Partial update object keyed by column name. Omit updated_at; multi_choice values should be arrays, and json values may be objects or arrays.",
          },
        },
        required: ["table", "id", "data"],
      },
    },
    {
      name: "delete",
      description: "Delete one row by id and return { affected }, where 0 means no row matched.",
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
      description: "Partially update every row matching a non-empty where clause and return { affected, ids }. where uses the same shapes and operators as query, including CONTAINS for multi_choice columns, updated_at is rewritten automatically, and the same write-value rules as insert apply. Use update for a single row by id.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          where: {
            description: "Required non-empty filter. Object form uses equality on each key and ANDs them together; array form uses explicit expressions.",
            ...whereClauseSchema,
          },
          data: {
            type: "object",
            description: "Partial update object keyed by column name. Omit updated_at; multi_choice values should be arrays, and json values may be objects or arrays.",
          },
          dryRun: {
            type: "boolean",
            description: "When true, return affected ids without modifying rows.",
          },
        },
        required: ["table", "where", "data"],
      },
    },
    {
      name: "delete_where",
      description: "Delete every row matching a non-empty where clause and return { affected, ids }. where uses the same shapes and operators as query, including CONTAINS for multi_choice columns. Use delete for a single row by id; to clear a whole table, drop and recreate it.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          where: {
            description: "Required non-empty filter. Object form uses equality on each key and ANDs them together; array form uses explicit expressions.",
            ...whereClauseSchema,
          },
          dryRun: {
            type: "boolean",
            description: "When true, return affected ids without modifying rows.",
          },
        },
        required: ["table", "where"],
      },
    },
    {
      name: "count",
      description: "Count rows in a table with an optional where clause and return { count }. where uses the same shapes and operators as query, including CONTAINS for multi_choice columns. Use this instead of query when you only need the number of matching rows.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          where: {
            description: "Optional filter. Object form uses equality on each key and ANDs them together; array form uses explicit expressions.",
            ...whereClauseSchema,
          },
        },
        required: ["table"],
      },
    },
    {
      name: "operation_log",
      description: "Return recent Data Store mutation operations. Use this when the user asks what an Agent or CLI recently changed.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum log entries to return. Defaults to 50." },
        },
      },
    },
    {
      name: "rename_table",
      description: "Rename a table without changing its rows, system columns, or stored metadata. The target name must not already exist and must start with a letter, contain only letters, digits, or underscores, and not start with _.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Current table name" },
          to: {
            type: "string",
            description: "New table name. Must start with a letter, use only letters, digits, or underscores, and not start with _.",
          },
        },
        required: ["from", "to"],
      },
    },
    {
      name: "rename_column",
      description: "Rename a user column without changing its data, description metadata, kind, or choices. The target column must not already exist, and both names follow the normal column rules: start with a letter, use only letters, digits, or underscores, cannot start with _, and cannot be id, created_at, or updated_at.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          from: { type: "string", description: "Current user column name" },
          to: {
            type: "string",
            description: "New column name. Must start with a letter, use only letters, digits, or underscores, and not be id, created_at, or updated_at.",
          },
        },
        required: ["table", "from", "to"],
      },
    },
    {
      name: "drop_column",
      description: "Drop one user column and all values stored in it. Cannot target id, created_at, or updated_at, and refuses to remove the last non-system column of a table.",
      inputSchema: {
        type: "object",
        properties: {
          table: tableNameProp,
          column: { type: "string", description: "User column name" },
        },
        required: ["table", "column"],
      },
    },
    {
      name: "read_sql",
      description: "Execute a read-only SQL statement with optional positional bind params. Allows SELECT, PRAGMA, and EXPLAIN. Prefer this over raw_sql for inspection and reporting.",
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
      name: "raw_sql",
      description: "Execute raw SQL with optional positional bind params. Prefer read_sql for inspection and structured tools for normal writes. Use raw_sql only when the user explicitly needs SQL-level DDL/DML or advanced repair. System tables prefixed with _ and ATTACH or DETACH are blocked.",
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
  ]
}

// Maps MCP tool names (snake_case) to canonical service action names (camelCase)
// used by the in-process service, the HTTP JSON API (http-server.ts), and the
// stdio MCP bridge (which forwards to HTTP).
const DATA_STORE_MCP_TOOL_ACTIONS: Record<string, string> = buildMcpToolActions()
const MCP_TOOL_ACTIONS: Record<string, string> = DATA_STORE_MCP_TOOL_ACTIONS

export {
  buildTools,
  buildTools as buildDataStoreTools,
  DATA_STORE_MCP_TOOL_ACTIONS,
  MCP_TOOL_ACTIONS,
}
export type { McpTool }
