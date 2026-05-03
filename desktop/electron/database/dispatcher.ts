// Single source of truth for "action name -> database service call" mapping.
// Both the HTTP JSON API (http-server.ts) and the in-process MCP server
// (mcp-server.ts) dispatch through this module so the two protocol surfaces
// can never drift.
//
// Every action returns the same result shape:
//   { ok: true, data?, affected?, total? }
// Transport layers wrap errors in their own protocol format.

import { databaseService } from "./service"
import type { Column, DatabaseOperationSource, DatabaseQueryParams, DatabaseWhereClause } from "./types"

type DispatchResult = {
  ok: true
  data?: unknown
  affected?: number
  total?: number
}

type ActionHandler = (params: Record<string, unknown>) => DispatchResult
type DispatchContext = { source?: DatabaseOperationSource }

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

function requireWhereClause(params: Record<string, unknown>, key: string): DatabaseWhereClause {
  const v = params[key]
  if (v === undefined || v === null) throw new Error(`Missing '${key}': expected non-empty object or array`)
  if (Array.isArray(v)) return v as DatabaseWhereClause
  if (typeof v === "object") return v as DatabaseWhereClause
  throw new Error(`Invalid '${key}': expected object or array`)
}

// --- action handlers ---

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  "database.table.list": () => ({ ok: true, data: databaseService.databaseTableList() }),

  "database.table.create": (params) => {
    databaseService.databaseTableCreate(
      requireString(params, "tableName"),
      requireArray(params, "columns") as Column[],
      params.description as string | undefined,
    )
    return { ok: true }
  },

  "database.table.delete": (params) => {
    databaseService.databaseTableDelete(requireString(params, "tableName"))
    return { ok: true }
  },

  "database.table.describe": (params) => ({
    ok: true,
    data: databaseService.databaseTableDescribe(requireString(params, "tableName")),
  }),

  "database.overview.get": () => ({
    ok: true,
    data: databaseService.databaseOverviewGet(),
  }),

  "database.table.update": (params) => {
    databaseService.databaseTableUpdate(
      requireString(params, "tableName"),
      requireText(params, "description"),
    )
    return { ok: true }
  },

  "database.column.create": (params) => {
    databaseService.databaseColumnCreate(
      requireString(params, "tableName"),
      requireObject(params, "column") as Column & { default?: unknown },
    )
    return { ok: true }
  },

  "database.column.update": (params) => {
    databaseService.databaseColumnUpdate(
      requireString(params, "tableName"),
      requireString(params, "columnName"),
      requireText(params, "description"),
    )
    return { ok: true }
  },

  "database.choice.update": (params) => {
    databaseService.databaseChoiceUpdate(
      requireString(params, "tableName"),
      requireString(params, "columnName"),
      requireArray(params, "choices") as string[],
    )
    return { ok: true }
  },

  "database.choice_usage.get": (params) => ({
    ok: true,
    data: databaseService.databaseChoiceUsageGet(
      requireString(params, "tableName"),
      requireString(params, "columnName"),
    ),
  }),

  "database.row.create": (params) => {
    const result = databaseService.databaseRowCreate(
      requireString(params, "tableName"),
      requireObject(params, "data"),
    )
    return { ok: true, data: result, affected: 1 }
  },

  "database.rows.create": (params) => {
    const result = databaseService.databaseRowsCreate(
      requireString(params, "tableName"),
      requireArray(params, "rows") as Record<string, unknown>[],
    )
    return { ok: true, data: result, affected: result.ids.length }
  },

  "database.row.list": (params) => {
    const result = databaseService.databaseRowList({
      table: requireString(params, "tableName"),
      where: params.where as DatabaseWhereClause | undefined,
      orderBy: params.orderBy as DatabaseQueryParams["orderBy"],
      limit: params.limit as number | undefined,
      offset: params.offset as number | undefined,
    })
    return { ok: true, data: result.rows, total: result.total }
  },

  "database.row.update": (params) => {
    const rowId = requireNumber(params, "rowId")
    const result = databaseService.databaseRowUpdate(
      requireString(params, "tableName"),
      rowId,
      requireObject(params, "data"),
    )
    return { ok: true, data: { id: rowId }, affected: result.affected }
  },

  "database.row.delete": (params) => {
    const rowId = requireNumber(params, "rowId")
    const result = databaseService.databaseRowDelete(
      requireString(params, "tableName"),
      rowId,
    )
    return { ok: true, data: { id: rowId }, affected: result.affected }
  },

  "database.rows.update": (params) => {
    const result = databaseService.databaseRowsUpdate(
      requireString(params, "tableName"),
      requireWhereClause(params, "where"),
      requireObject(params, "data"),
      { dryRun: params.dryRun === true },
    )
    return { ok: true, data: { ids: result.ids, dryRun: result.dryRun }, affected: result.affected }
  },

  "database.rows.delete": (params) => {
    const result = databaseService.databaseRowsDelete(
      requireString(params, "tableName"),
      requireWhereClause(params, "where"),
      { dryRun: params.dryRun === true },
    )
    return { ok: true, data: { ids: result.ids, dryRun: result.dryRun }, affected: result.affected }
  },

  "database.row.count": (params) => {
    const where = params.where as DatabaseWhereClause | undefined
    const result = databaseService.databaseRowCount(requireString(params, "tableName"), where)
    return { ok: true, data: result }
  },

  "database.log.list": (params) => ({
    ok: true,
    data: databaseService.databaseLogList(
      typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit >= 0 ? params.limit : 50,
    ),
  }),

  "database.table.rename": (params) => {
    databaseService.databaseTableRename(
      requireString(params, "fromTableName"),
      requireString(params, "toTableName"),
    )
    return { ok: true }
  },

  "database.column.rename": (params) => {
    databaseService.databaseColumnRename(
      requireString(params, "tableName"),
      requireString(params, "fromColumnName"),
      requireString(params, "toColumnName"),
    )
    return { ok: true }
  },

  "database.column.delete": (params) => {
    databaseService.databaseColumnDelete(
      requireString(params, "tableName"),
      requireString(params, "columnName"),
    )
    return { ok: true }
  },

  "database.sql.read": (params) => ({
    ok: true,
    data: databaseService.databaseSqlRead(
      requireString(params, "sql"),
      params.params as unknown[] | undefined,
    ),
  }),

  "database.sql.execute": (params) => {
    const result = databaseService.databaseSqlExecute(
      requireString(params, "sql"),
      params.params as unknown[] | undefined,
    )
    if (result.rows) return { ok: true, data: { rows: result.rows } }
    return { ok: true, data: { changes: result.changes, lastInsertRowid: result.lastInsertRowid } }
  },
}

const MUTATING_ACTIONS = new Set<string>([
  "database.table.create",
  "database.table.delete",
  "database.table.update",
  "database.column.create",
  "database.column.update",
  "database.choice.update",
  "database.row.create",
  "database.rows.create",
  "database.row.update",
  "database.row.delete",
  "database.rows.update",
  "database.rows.delete",
  "database.table.rename",
  "database.column.rename",
  "database.column.delete",
  "database.sql.execute",
])

type DatabaseChangeEvent = { action: string; table?: string }
type DatabaseChangeListener = (event: DatabaseChangeEvent) => void

let changeListener: DatabaseChangeListener | null = null

function setDatabaseChangeListener(listener: DatabaseChangeListener | null): void {
  changeListener = listener
}

function extractTableName(action: string, params: Record<string, unknown>): string | undefined {
  if (action === "database.table.rename") {
    return typeof params.toTableName === "string" ? params.toTableName : undefined
  }
  if (typeof params.tableName === "string") return params.tableName
  return undefined
}

function dispatchDatabaseAction(action: string, params: Record<string, unknown>, context: DispatchContext = {}): DispatchResult {
  const handler = ACTION_HANDLERS[action]
  if (!handler) throw new Error(`Unknown action: ${action}`)
  const result = handler(params)
  if (MUTATING_ACTIONS.has(action)) {
    databaseService.recordOperation({
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

function hasDatabaseAction(action: string): boolean {
  return action in ACTION_HANDLERS
}

export { dispatchDatabaseAction, hasDatabaseAction, setDatabaseChangeListener }
export type { DispatchContext, DispatchResult, DatabaseChangeEvent, DatabaseChangeListener }
