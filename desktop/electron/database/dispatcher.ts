// Single source of truth for "action name -> database service call" mapping.
// Both the HTTP JSON API (http-server.ts) and the in-process MCP server
// (mcp-server.ts) dispatch through this module so the two protocol surfaces
// can never drift.
//
// Every action returns the same result shape:
//   { ok: true, data?, affected?, total? }
// Transport layers wrap errors in their own protocol format.

import { databaseService } from "./service"
import { getMutatingActions } from "../../database/shared/capability-registry"
import {
  DATABASE_OPERATION_LOG_LIST_DEFAULT_LIMIT,
  DATABASE_OPERATION_LOG_LIST_MAX_LIMIT,
  DATABASE_ROW_LIST_MAX_LIMIT,
} from "../../database/shared/limits"
import { sanitizeError } from "../services/error-sanitize"
import { createMainLogger } from "../services/log-store"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import type { Column, DatabaseOperationSource, DatabaseQueryParams, DatabaseWhereClause } from "./types"

const logger = createMainLogger("database.dispatcher")

type DispatchResult = {
  ok: true
  data?: unknown
  affected?: number
  total?: number
}

type ActionHandler = (params: Record<string, unknown>) => DispatchResult
type DispatchContext = { source?: DatabaseOperationSource; actor?: ActorIdentity }
type DatabaseDispatchSecurityDeps = {
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
}
type DatabaseActionSecurity = {
  readonly action: "database.read" | "database.mutate"
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

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

function optionalNonNegativeInteger(params: Record<string, unknown>, key: string): number | undefined {
  if (params[key] === undefined) return undefined
  const value = requireNumber(params, key)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid '${key}': expected non-negative integer`)
  }
  return value
}

function optionalRowListLimit(params: Record<string, unknown>): number | undefined {
  const limit = optionalNonNegativeInteger(params, "limit")
  if (limit !== undefined && limit > DATABASE_ROW_LIST_MAX_LIMIT) {
    throw new Error(`Invalid 'limit': expected integer between 0 and ${DATABASE_ROW_LIST_MAX_LIMIT}`)
  }
  return limit
}

function optionalOperationLogListLimit(params: Record<string, unknown>): number {
  const limit = optionalNonNegativeInteger(params, "limit")
  if (limit !== undefined && limit > DATABASE_OPERATION_LOG_LIST_MAX_LIMIT) {
    throw new Error(`Invalid 'limit': expected integer between 0 and ${DATABASE_OPERATION_LOG_LIST_MAX_LIMIT}`)
  }
  return limit ?? DATABASE_OPERATION_LOG_LIST_DEFAULT_LIMIT
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
      limit: optionalRowListLimit(params),
      offset: optionalNonNegativeInteger(params, "offset"),
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
    data: databaseService.databaseLogList(optionalOperationLogListLimit(params)),
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

  "database.folder.list": () => ({
    ok: true,
    data: databaseService.folderList(),
  }),

  "database.folder.create": (params) => {
    const result = databaseService.folderCreate(requireString(params, "name"))
    return { ok: true, data: result }
  },

  "database.folder.rename": (params) => {
    databaseService.folderRename(requireNumber(params, "folderId"), requireString(params, "name"))
    return { ok: true }
  },

  "database.folder.delete": (params) => {
    databaseService.folderDelete(requireNumber(params, "folderId"))
    return { ok: true }
  },

  "database.folder.reorder": (params) => {
    databaseService.folderReorderFolders(requireArray(params, "folderIds") as number[])
    return { ok: true }
  },

  "database.table.move": (params) => {
    const folderId = params.folderId as number | null | undefined
    databaseService.folderMoveTable(requireString(params, "tableName"), folderId === undefined ? null : folderId)
    return { ok: true }
  },
}

const MUTATING_ACTIONS = new Set<string>(getMutatingActions())
const SAFE_AUDIT_TABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

type DatabaseChangeEvent = { action: string; table?: string }
type DatabaseChangeListener = (event: DatabaseChangeEvent) => void

let changeListener: DatabaseChangeListener | null = null

function setDatabaseChangeListener(listener: DatabaseChangeListener | null): void {
  changeListener = listener
}

function notifyDatabaseChange(action: string, table?: string): void {
  if (!changeListener) {
    return
  }
  try {
    changeListener({ action, table })
  } catch (error) {
    logger.warn("Database mutation change notification failed.", {
      action,
      errorLength: String(error).length,
      errorName: error instanceof Error ? error.name : typeof error,
      source: "ipc",
      table,
    })
  }
}

function extractTableName(action: string, params: Record<string, unknown>): string | undefined {
  if (action === "database.table.rename") {
    return typeof params.toTableName === "string" ? params.toTableName : undefined
  }
  if (typeof params.tableName === "string") return params.tableName
  return undefined
}

function extractAuditTableName(action: string, params: Record<string, unknown>): string | undefined {
  const tableName = extractTableName(action, params)?.trim()
  return tableName && SAFE_AUDIT_TABLE_PATTERN.test(tableName) ? tableName : undefined
}

function databaseSideEffectErrorMeta(
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
  error: unknown,
): Record<string, unknown> {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const sanitizedMessage = sanitizeError(rawMessage)
  return {
    action,
    dryRun: params.dryRun === true,
    errorLength: rawMessage.length,
    errorName: error instanceof Error ? error.name : typeof error,
    ...(sanitizedMessage ? { error: sanitizedMessage } : {}),
    source: context.source ?? "api",
    table: extractAuditTableName(action, params),
  }
}

async function dispatchDatabaseAction(
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext = {},
  securityDeps: DatabaseDispatchSecurityDeps = {},
): Promise<DispatchResult> {
  const handler = ACTION_HANDLERS[action]
  if (!handler) throw new Error(`Unknown action: ${action}`)
  const security = databaseActionSecurity(action, params, context)
  await authorizeDatabaseAction(securityDeps, security)

  try {
    const result = handler(params)
    if (MUTATING_ACTIONS.has(action)) {
      try {
        databaseService.recordOperation({
          source: context.source ?? "api",
          action,
          table: extractTableName(action, params),
          affected: result.affected,
          dryRun: params.dryRun === true,
        })
      } catch (error) {
        logger.warn("Database mutation operation log write failed.", databaseSideEffectErrorMeta(
          action,
          params,
          context,
          error,
        ))
        // Never let an operation log failure break the dispatch result.
      }
    }
    if (MUTATING_ACTIONS.has(action) && params.dryRun !== true && changeListener) {
      try {
        changeListener({ action, table: extractTableName(action, params) })
      } catch (error) {
        logger.warn("Database mutation change notification failed.", databaseSideEffectErrorMeta(
          action,
          params,
          context,
          error,
        ))
        // Never let a broadcast failure break the dispatch result.
      }
    }
    if (security) {
      securityDeps.auditSink?.record({
        action: security.action,
        actor: security.actor,
        resource: security.resource,
        outcome: "allowed",
        metadata: security.metadata,
      })
    }
    return result
  } catch (error) {
    if (security) {
      securityDeps.auditSink?.record({
        action: security.action,
        actor: security.actor,
        resource: security.resource,
        outcome: "failed",
        metadata: {
          ...security.metadata,
          errorName: error instanceof Error ? error.name : typeof error,
          errorLength: String(error).length,
        },
      })
    }
    throw error
  }
}

async function authorizeDatabaseAction(
  deps: DatabaseDispatchSecurityDeps,
  security: DatabaseActionSecurity | null,
): Promise<void> {
  if (!security) return
  const permission = await deps.permissionGuard?.check({
    action: security.action,
    actor: security.actor,
    resource: security.resource,
    context: security.metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: security.action,
      actor: security.actor,
      resource: security.resource,
      outcome: "denied",
      metadata: {
        ...security.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
}

function databaseActionSecurity(
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): DatabaseActionSecurity | null {
  const source = context.source ?? "api"
  const table = extractAuditTableName(action, params)
  const dryRun = params.dryRun === true
  const securityAction = MUTATING_ACTIONS.has(action) ? "database.mutate" : "database.read"
  return {
    action: securityAction,
    actor: context.actor ?? { kind: "user", id: `database-dispatch:${source}` },
    resource: `database:${table ?? action}`,
    metadata: {
      source,
      databaseAction: action,
      ...(table ? { table } : {}),
      ...(MUTATING_ACTIONS.has(action) ? { dryRun } : {}),
    },
  }
}

function hasDatabaseAction(action: string): boolean {
  return action in ACTION_HANDLERS
}

export { dispatchDatabaseAction, hasDatabaseAction, notifyDatabaseChange, setDatabaseChangeListener }
export type {
  DatabaseDispatchSecurityDeps,
  DispatchContext,
  DispatchResult,
  DatabaseChangeEvent,
  DatabaseChangeListener,
}
