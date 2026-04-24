// Single source of truth for "action name -> data-store service call" mapping.
// Both the HTTP JSON API (http-server.ts) and the in-process MCP server
// (mcp-server.ts) dispatch through this module so the two protocol surfaces
// can never drift.
//
// Every action returns the same result shape:
//   { ok: true, data?, affected?, total? }
// Transport layers wrap errors in their own protocol format.

import { dataStoreService } from "./service"
import type { DataStoreQueryParams, DataStoreWhereClause } from "./types"

type DispatchResult = {
  ok: true
  data?: unknown
  affected?: number
  total?: number
}

type ActionHandler = (params: Record<string, unknown>) => DispatchResult

// --- parameter validation helpers ---

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  if (typeof v !== "string" || !v) throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  return v
}

function requireNumber(params: Record<string, unknown>, key: string): number {
  const v = params[key]
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Missing or invalid '${key}': expected number`)
  return v
}

function requireObject(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key]
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`Missing or invalid '${key}': expected object`)
  return v as Record<string, unknown>
}

function requireArray(params: Record<string, unknown>, key: string): unknown[] {
  const v = params[key]
  if (!Array.isArray(v)) throw new Error(`Missing or invalid '${key}': expected array`)
  return v
}

function requireWhereClause(params: Record<string, unknown>, key: string): DataStoreWhereClause {
  const v = params[key]
  if (v === undefined || v === null) throw new Error(`Missing '${key}': expected non-empty object or array`)
  if (Array.isArray(v)) return v as DataStoreWhereClause
  if (typeof v === "object") return v as DataStoreWhereClause
  throw new Error(`Invalid '${key}': expected object or array`)
}

// --- action handlers ---

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  listTables: () => ({ ok: true, data: dataStoreService.listTables() }),

  createTable: (params) => {
    dataStoreService.createTable(
      requireString(params, "name"),
      requireArray(params, "columns") as { name: string; type: "TEXT" | "INTEGER" | "REAL" | "BLOB" | "JSON" | "DATE" | "DATETIME" | "BOOLEAN" | "ENUM" | "MULTI_ENUM"; enumValues?: string[] }[],
      params.description as string | undefined,
    )
    return { ok: true }
  },

  dropTable: (params) => {
    dataStoreService.dropTable(requireString(params, "name"))
    return { ok: true }
  },

  describeTable: (params) => ({
    ok: true,
    data: dataStoreService.describeTable(requireString(params, "name")),
  }),

  addColumn: (params) => {
    // Legacy callers pass 'name' instead of 'table'; keep both shapes working.
    const tableRaw = params.table ?? params.name
    if (typeof tableRaw !== "string" || !tableRaw) {
      throw new Error("Missing or invalid 'table' (or 'name'): expected non-empty string")
    }
    dataStoreService.addColumn(
      tableRaw,
      requireObject(params, "column") as { name: string; type: "TEXT" | "INTEGER" | "REAL" | "BLOB" | "JSON" | "DATE" | "DATETIME" | "BOOLEAN" | "ENUM" | "MULTI_ENUM"; default?: unknown; description?: string; enumValues?: string[] },
    )
    return { ok: true }
  },

  updateColumnDescription: (params) => {
    dataStoreService.updateColumnDescription(
      requireString(params, "table"),
      requireString(params, "column"),
      requireString(params, "description"),
    )
    return { ok: true }
  },

  updateColumnEnumValues: (params) => {
    dataStoreService.updateColumnEnumValues(
      requireString(params, "table"),
      requireString(params, "column"),
      requireArray(params, "values") as string[],
    )
    return { ok: true }
  },

  insert: (params) => {
    const result = dataStoreService.insert(
      requireString(params, "table"),
      requireObject(params, "data"),
    )
    return { ok: true, data: result, affected: 1 }
  },

  batchInsert: (params) => {
    const result = dataStoreService.batchInsert(
      requireString(params, "table"),
      requireArray(params, "rows") as Record<string, unknown>[],
    )
    return { ok: true, data: result, affected: result.ids.length }
  },

  query: (params) => {
    requireString(params, "table")
    const result = dataStoreService.query(params as DataStoreQueryParams)
    return { ok: true, data: result.rows, total: result.total }
  },

  update: (params) => {
    const result = dataStoreService.update(
      requireString(params, "table"),
      requireNumber(params, "id"),
      requireObject(params, "data"),
    )
    return { ok: true, data: { id: params.id }, affected: result.affected }
  },

  delete: (params) => {
    const result = dataStoreService.delete(
      requireString(params, "table"),
      requireNumber(params, "id"),
    )
    return { ok: true, data: { id: params.id }, affected: result.affected }
  },

  updateWhere: (params) => {
    const result = dataStoreService.updateWhere(
      requireString(params, "table"),
      requireWhereClause(params, "where"),
      requireObject(params, "data"),
    )
    return { ok: true, data: { ids: result.ids }, affected: result.affected }
  },

  deleteWhere: (params) => {
    const result = dataStoreService.deleteWhere(
      requireString(params, "table"),
      requireWhereClause(params, "where"),
    )
    return { ok: true, data: { ids: result.ids }, affected: result.affected }
  },

  count: (params) => {
    const where = params.where as DataStoreWhereClause | undefined
    const result = dataStoreService.count(requireString(params, "table"), where)
    return { ok: true, data: result }
  },

  renameTable: (params) => {
    dataStoreService.renameTable(
      requireString(params, "from"),
      requireString(params, "to"),
    )
    return { ok: true }
  },

  renameColumn: (params) => {
    dataStoreService.renameColumn(
      requireString(params, "table"),
      requireString(params, "from"),
      requireString(params, "to"),
    )
    return { ok: true }
  },

  dropColumn: (params) => {
    dataStoreService.dropColumn(
      requireString(params, "table"),
      requireString(params, "column"),
    )
    return { ok: true }
  },

  rawSQL: (params) => {
    const result = dataStoreService.rawSQL(
      requireString(params, "sql"),
      params.params as unknown[] | undefined,
    )
    if (result.rows) return { ok: true, data: { rows: result.rows } }
    return { ok: true, data: { changes: result.changes, lastInsertRowid: result.lastInsertRowid } }
  },
}

const MUTATING_ACTIONS = new Set<string>([
  "createTable",
  "dropTable",
  "addColumn",
  "updateColumnDescription",
  "updateColumnEnumValues",
  "insert",
  "batchInsert",
  "update",
  "delete",
  "updateWhere",
  "deleteWhere",
  "renameTable",
  "renameColumn",
  "dropColumn",
  "rawSQL",
])

type DataStoreChangeEvent = { action: string; table?: string }
type DataStoreChangeListener = (event: DataStoreChangeEvent) => void

let changeListener: DataStoreChangeListener | null = null

function setDataStoreChangeListener(listener: DataStoreChangeListener | null): void {
  changeListener = listener
}

function extractTableName(action: string, params: Record<string, unknown>): string | undefined {
  if (action === "renameTable") {
    return typeof params.to === "string" ? params.to : undefined
  }
  if (typeof params.table === "string") return params.table
  if (typeof params.name === "string") return params.name
  return undefined
}

function dispatchDataStoreAction(action: string, params: Record<string, unknown>): DispatchResult {
  const handler = ACTION_HANDLERS[action]
  if (!handler) throw new Error(`Unknown action: ${action}`)
  const result = handler(params)
  if (MUTATING_ACTIONS.has(action) && changeListener) {
    try {
      changeListener({ action, table: extractTableName(action, params) })
    } catch {
      // Never let a broadcast failure break the dispatch result.
    }
  }
  return result
}

function hasDataStoreAction(action: string): boolean {
  return action in ACTION_HANDLERS
}

export { dispatchDataStoreAction, hasDataStoreAction, setDataStoreChangeListener }
export type { DispatchResult, DataStoreChangeEvent, DataStoreChangeListener }
