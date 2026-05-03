// Single source of truth for "action name -> data-store service call" mapping.
// Both the HTTP JSON API (http-server.ts) and the in-process MCP server
// (mcp-server.ts) dispatch through this module so the two protocol surfaces
// can never drift.
//
// Every action returns the same result shape:
//   { ok: true, data?, affected?, total? }
// Transport layers wrap errors in their own protocol format.

import { dataStoreService } from "./service"
import type { Column, DataStoreOperationSource, DataStoreQueryParams, DataStoreWhereClause } from "./types"

type DispatchResult = {
  ok: true
  data?: unknown
  affected?: number
  total?: number
}

type ActionHandler = (params: Record<string, unknown>) => DispatchResult
type DispatchContext = { source?: DataStoreOperationSource }

// --- parameter validation helpers ---

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  if (typeof v !== "string" || !v) throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  return v
}

function requireText(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  if (typeof v !== "string") throw new Error(`Missing or invalid '${key}': expected string`)
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
  "database.table.list": () => ({ ok: true, data: dataStoreService.listTables() }),

  "database.table.create": (params) => {
    dataStoreService.createTable(
      requireString(params, "name"),
      requireArray(params, "columns") as Column[],
      params.description as string | undefined,
    )
    return { ok: true }
  },

  "database.table.delete": (params) => {
    dataStoreService.dropTable(requireString(params, "name"))
    return { ok: true }
  },

  "database.table.describe": (params) => ({
    ok: true,
    data: dataStoreService.describeTable(requireString(params, "name")),
  }),

  "database.overview.get": () => ({
    ok: true,
    data: dataStoreService.getDatabaseOverview(),
  }),

  "database.table.update": (params) => {
    dataStoreService.updateTableDescription(
      requireString(params, "table"),
      requireText(params, "description"),
    )
    return { ok: true }
  },

  "database.column.create": (params) => {
    // Legacy callers pass 'name' instead of 'table'; keep both shapes working.
    const tableRaw = params.table ?? params.name
    if (typeof tableRaw !== "string" || !tableRaw) {
      throw new Error("Missing or invalid 'table' (or 'name'): expected non-empty string")
    }
    dataStoreService.addColumn(
      tableRaw,
      requireObject(params, "column") as Column & { default?: unknown },
    )
    return { ok: true }
  },

  "database.column.update": (params) => {
    dataStoreService.updateColumnDescription(
      requireString(params, "table"),
      requireString(params, "column"),
      requireText(params, "description"),
    )
    return { ok: true }
  },

  "database.choice.update": (params) => {
    dataStoreService.updateColumnChoices(
      requireString(params, "table"),
      requireString(params, "column"),
      requireArray(params, "choices") as string[],
    )
    return { ok: true }
  },

  "database.choice_usage.get": (params) => ({
    ok: true,
    data: dataStoreService.getColumnChoicesUsage(
      requireString(params, "table"),
      requireString(params, "column"),
    ),
  }),

  "database.row.create": (params) => {
    const result = dataStoreService.insert(
      requireString(params, "table"),
      requireObject(params, "data"),
    )
    return { ok: true, data: result, affected: 1 }
  },

  "database.rows.create": (params) => {
    const result = dataStoreService.batchInsert(
      requireString(params, "table"),
      requireArray(params, "rows") as Record<string, unknown>[],
    )
    return { ok: true, data: result, affected: result.ids.length }
  },

  "database.row.list": (params) => {
    requireString(params, "table")
    const result = dataStoreService.query(params as DataStoreQueryParams)
    return { ok: true, data: result.rows, total: result.total }
  },

  "database.row.update": (params) => {
    const result = dataStoreService.update(
      requireString(params, "table"),
      requireNumber(params, "id"),
      requireObject(params, "data"),
    )
    return { ok: true, data: { id: params.id }, affected: result.affected }
  },

  "database.row.delete": (params) => {
    const result = dataStoreService.delete(
      requireString(params, "table"),
      requireNumber(params, "id"),
    )
    return { ok: true, data: { id: params.id }, affected: result.affected }
  },

  "database.rows.update": (params) => {
    const result = dataStoreService.updateWhere(
      requireString(params, "table"),
      requireWhereClause(params, "where"),
      requireObject(params, "data"),
      { dryRun: params.dryRun === true },
    )
    return { ok: true, data: { ids: result.ids, dryRun: result.dryRun }, affected: result.affected }
  },

  "database.rows.delete": (params) => {
    const result = dataStoreService.deleteWhere(
      requireString(params, "table"),
      requireWhereClause(params, "where"),
      { dryRun: params.dryRun === true },
    )
    return { ok: true, data: { ids: result.ids, dryRun: result.dryRun }, affected: result.affected }
  },

  "database.row.count": (params) => {
    const where = params.where as DataStoreWhereClause | undefined
    const result = dataStoreService.count(requireString(params, "table"), where)
    return { ok: true, data: result }
  },

  "database.log.list": (params) => ({
    ok: true,
    data: dataStoreService.listOperationLog(
      typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit >= 0 ? params.limit : 50,
    ),
  }),

  "database.table.rename": (params) => {
    dataStoreService.renameTable(
      requireString(params, "from"),
      requireString(params, "to"),
    )
    return { ok: true }
  },

  "database.column.rename": (params) => {
    dataStoreService.renameColumn(
      requireString(params, "table"),
      requireString(params, "from"),
      requireString(params, "to"),
    )
    return { ok: true }
  },

  "database.column.delete": (params) => {
    dataStoreService.dropColumn(
      requireString(params, "table"),
      requireString(params, "column"),
    )
    return { ok: true }
  },

  "database.sql.read": (params) => ({
    ok: true,
    data: dataStoreService.readSQL(
      requireString(params, "sql"),
      params.params as unknown[] | undefined,
    ),
  }),

  "database.sql.execute": (params) => {
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
  "updateTableDescription",
  "addColumn",
  "updateColumnDescription",
  "updateColumnChoices",
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

function dispatchDataStoreAction(action: string, params: Record<string, unknown>, context: DispatchContext = {}): DispatchResult {
  const handler = ACTION_HANDLERS[action]
  if (!handler) throw new Error(`Unknown action: ${action}`)
  const result = handler(params)
  if (MUTATING_ACTIONS.has(action)) {
    dataStoreService.recordOperation({
      source: context.source ?? "api",
      action,
      table: extractTableName(action, params),
      affected: result.affected,
      dryRun: params.dryRun === true,
    })
  }
  if (MUTATING_ACTIONS.has(action) && params.dryRun !== true && changeListener) {
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
export type { DispatchContext, DispatchResult, DataStoreChangeEvent, DataStoreChangeListener }
