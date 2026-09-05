/**
 * Phase 0.2 — SQLite-backed namespace for large collections.
 *
 * SPEC §5: `conversations` and `outbox` go here (millions of rows). Each
 * SqliteNamespace owns a single table:
 *
 *   CREATE TABLE <namespace> (
 *     id TEXT PRIMARY KEY,
 *     value TEXT NOT NULL,            -- JSON.stringify(record)
 *     created_at TEXT NOT NULL,
 *     updated_at TEXT NOT NULL
 *   );
 *
 *   CREATE TABLE __synapse_meta (
 *     namespace TEXT PRIMARY KEY,
 *     schema_version INTEGER NOT NULL
 *   );
 *
 * Each namespace can register additional indexes via `indexes: ["json_extract(value, '$.foo')"]`.
 *
 * Singleton mode keeps the singleton in row id="__singleton".
 *
 * Phase 0.2 keeps this minimal — Phase M2 (per SPEC §15.6) adds FTS5 and
 * archive-aware list().
 *
 * NOTE: This is a SEPARATE backend from `electron/database/` (the MCP
 * business-data layer). They both happen to use better-sqlite3 (via node:sqlite),
 * but their schemas, lifecycles, and consumers are independent. The SPEC §5
 * `business-db` namespace will simply re-export the existing databaseService
 * unchanged and is implemented in T2.5 alongside this generic backend.
 */

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { mkdirSync } from "node:fs"

import { AbstractDataNamespace, type NamespaceBaseDeps } from "../namespace-base"
import { InvalidNamespaceDataError } from "../errors"
import type { DataListWindowItem, DataListWindowOptions } from "../types"

const SINGLETON_ID = "__singleton"
const META_TABLE = "__synapse_meta"
const SAFE_JSON_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface SqliteBackendDeps<T> extends NamespaceBaseDeps<T> {
  /** Shared database handle. Multiple namespaces can share the same db. */
  readonly database: DatabaseSync | (() => DatabaseSync)
  readonly indexes?: readonly string[]
  readonly validate?: (data: unknown) => data is T
}

export class SqliteNamespace<T extends Record<string, unknown> & { id: string }>
  extends AbstractDataNamespace<T>
{
  private readonly databaseProvider: () => DatabaseSync
  private database: DatabaseSync | null = null
  private schemaReady = false
  private readonly tableName: string
  private readonly indexes: readonly string[]
  private readonly validate?: (data: unknown) => data is T
  private prepared: {
    upsert: ReturnType<DatabaseSync["prepare"]>
    get: ReturnType<DatabaseSync["prepare"]>
    delete: ReturnType<DatabaseSync["prepare"]>
    list: ReturnType<DatabaseSync["prepare"]>
    count: ReturnType<DatabaseSync["prepare"]>
  } | null = null

  constructor(deps: SqliteBackendDeps<T>) {
    super({ ...deps, backend: "sqlite" })
    this.databaseProvider = typeof deps.database === "function"
      ? deps.database
      : () => deps.database as DatabaseSync
    this.tableName = sanitizeTableName(deps.name)
    this.indexes = deps.indexes ?? []
    this.validate = deps.validate
  }

  private ensureSchema(): void {
    if (this.schemaReady) return
    const database = this.getDatabase()
    database.exec(`
      CREATE TABLE IF NOT EXISTS ${META_TABLE} (
        namespace TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    let i = 0
    for (const expr of this.indexes) {
      const indexName = `idx_${this.tableName}_${i++}`
      database.exec(
        `CREATE INDEX IF NOT EXISTS ${indexName} ON ${this.tableName}(${expr});`,
      )
    }

    const upsertMeta = database.prepare(
      `INSERT INTO ${META_TABLE}(namespace, schema_version) VALUES (?, ?)
       ON CONFLICT(namespace) DO UPDATE SET schema_version=excluded.schema_version;`,
    )
    upsertMeta.run(this.name, this.schemaVersion)
    this.schemaReady = true
  }

  private getDatabase(): DatabaseSync {
    this.database ??= this.databaseProvider()
    return this.database
  }

  private prep() {
    if (this.prepared) return this.prepared
    this.ensureSchema()
    const database = this.getDatabase()
    this.prepared = {
      upsert: database.prepare(
        `INSERT INTO ${this.tableName}(id, value, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;`,
      ),
      get: database.prepare(
        `SELECT value FROM ${this.tableName} WHERE id = ? LIMIT 1;`,
      ),
      delete: database.prepare(
        `DELETE FROM ${this.tableName} WHERE id = ?;`,
      ),
      list: database.prepare(
        `SELECT value FROM ${this.tableName} WHERE id != ? ORDER BY id;`,
      ),
      count: database.prepare(
        `SELECT COUNT(*) as n FROM ${this.tableName};`,
      ),
    }
    return this.prepared
  }

  private parseRow(rawValue: unknown): T {
    if (typeof rawValue !== "string") {
      throw new InvalidNamespaceDataError(this.name, "value column is not a string")
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(rawValue)
    } catch (err) {
      throw new InvalidNamespaceDataError(
        this.name,
        `value column is not valid JSON: ${(err as Error).message}`,
      )
    }
    if (this.validate && !this.validate(parsed)) {
      throw new InvalidNamespaceDataError(this.name, "row failed validate()")
    }
    return parsed as T
  }

  async getSingleton(): Promise<T | null> {
    const row = this.prep().get.get(SINGLETON_ID) as { value?: unknown } | undefined
    if (!row || row.value === undefined) {
      return this.defaults?.() ?? null
    }
    return this.parseRow(row.value)
  }

  async setSingleton(value: T): Promise<void> {
    const previous = await this.getSingleton()
    const now = new Date().toISOString()
    this.prep().upsert.run(SINGLETON_ID, JSON.stringify(value), now, now)
    this.emit({
      kind: "replace",
      value,
      previous: previous ?? undefined,
    })
  }

  async clearSingleton(): Promise<void> {
    const previous = await this.getSingleton()
    this.prep().delete.run(SINGLETON_ID)
    if (previous !== null) {
      this.emit({ kind: "clear", previous })
    }
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    const rows = this.listRows(filter)
    const items = rows.map((r) => this.parseRow(r.value))
    return this.applyFilter(items, filter)
  }

  async listWindow(options: DataListWindowOptions<T>): Promise<DataListWindowItem<T>[]> {
    this.ensureSchema()
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1_000) {
      throw new InvalidNamespaceDataError(this.name, "list window limit must be between 1 and 1000")
    }
    const offset = options.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new InvalidNamespaceDataError(this.name, "list window offset must be a non-negative safe integer")
    }

    const clauses = ["id != ?"]
    const params: SqliteFilterParam[] = [SINGLETON_ID]
    for (const [key, value] of Object.entries(options.filter ?? {})) {
      if (!isSqliteFilterParam(value)) {
        throw new InvalidNamespaceDataError(this.name, "list window filters are invalid")
      }
      const jsonKey = safeJsonKey(this.name, key)
      clauses.push(`json_extract(value, '$.${jsonKey}') = ?`)
      params.push(value)
    }
    for (const [key, excludedValues] of Object.entries(options.exclude ?? {})) {
      const jsonKey = safeJsonKey(this.name, key)
      if (!Array.isArray(excludedValues) || excludedValues.length === 0) continue
      if (excludedValues.length > 500 || !excludedValues.every(isSqliteFilterParam)) {
        throw new InvalidNamespaceDataError(this.name, "list window exclusions are invalid")
      }
      clauses.push(`json_extract(value, '$.${jsonKey}') NOT IN (${excludedValues.map(() => "?").join(", ")})`)
      params.push(...excludedValues)
    }

    const requestedOrderKeys = Array.isArray(options.orderBy)
      ? options.orderBy
      : [options.orderBy ?? "updatedAt"]
    if (requestedOrderKeys.length === 0 || requestedOrderKeys.length > 4) {
      throw new InvalidNamespaceDataError(this.name, "list window ordering is invalid")
    }
    const orderKeys = requestedOrderKeys.map((key) => safeJsonKey(this.name, String(key)))
    const direction = options.order === "asc" ? "ASC" : "DESC"
    const orderClause = [
      ...orderKeys.map((key) => `json_extract(value, '$.${key}') ${direction}`),
      `id ${direction}`,
    ].join(", ")
    const arrayTail = options.arrayTail ? safeJsonKey(this.name, String(options.arrayTail)) : undefined
    const valueExpression = arrayTail
      ? `CASE
          WHEN json_type(value, '$.${arrayTail}') = 'array' THEN json_set(
            value,
            '$.${arrayTail}',
            CASE
              WHEN json_array_length(value, '$.${arrayTail}') > 0
                THEN json_array(json_extract(value, '$.${arrayTail}[#-1]'))
              ELSE json('[]')
            END
          )
          ELSE value
        END`
      : "value"
    const lengthExpression = arrayTail
      ? `json_array_length(value, '$.${arrayTail}')`
      : "NULL"
    const rows = this.getDatabase().prepare(
      `SELECT ${valueExpression} AS value, ${lengthExpression} AS array_length
       FROM ${this.tableName}
       WHERE ${clauses.join(" AND ")}
       ORDER BY ${orderClause}
       LIMIT ? OFFSET ?;`,
    ).all(...params, options.limit, offset) as Array<{ value?: unknown; array_length?: unknown }>

    return rows.map((row) => ({
      value: this.parseRow(row.value),
      ...(typeof row.array_length === "number" ? { arrayLength: row.array_length } : {}),
    }))
  }

  async count(filter?: Partial<T>): Promise<number> {
    this.ensureSchema()
    const pushedFilter = buildSqliteFilter(filter)
    if (filter && !pushedFilter) {
      return super.count(filter)
    }
    if (!pushedFilter) {
      const row = this.getDatabase()
        .prepare(`SELECT COUNT(*) as n FROM ${this.tableName} WHERE id != ?;`)
        .get(SINGLETON_ID) as { n?: number } | undefined
      return row?.n ?? 0
    }
    const statement = this.getDatabase().prepare(
      `SELECT COUNT(*) as n FROM ${this.tableName}
       WHERE id != ? AND ${pushedFilter.where};`,
    )
    const row = statement.get(SINGLETON_ID, ...pushedFilter.params) as { n?: number } | undefined
    return row?.n ?? 0
  }

  private listRows(filter?: Partial<T>): Array<{ value?: unknown }> {
    this.ensureSchema()
    const pushedFilter = buildSqliteFilter(filter)
    if (!pushedFilter) {
      return this.prep().list.all(SINGLETON_ID) as Array<{ value?: unknown }>
    }
    const statement = this.getDatabase().prepare(
      `SELECT value FROM ${this.tableName}
       WHERE id != ? AND ${pushedFilter.where}
       ORDER BY id;`,
    )
    return statement.all(SINGLETON_ID, ...pushedFilter.params) as Array<{ value?: unknown }>
  }

  async get(id: string): Promise<T | null> {
    if (id === SINGLETON_ID) return null
    const row = this.prep().get.get(id) as { value?: unknown } | undefined
    if (!row || row.value === undefined) return null
    return this.parseRow(row.value)
  }

  async upsert(item: T & { id: string }): Promise<void> {
    if (item.id === SINGLETON_ID) {
      throw new InvalidNamespaceDataError(this.name, `id "${SINGLETON_ID}" is reserved`)
    }
    const previous = await this.get(item.id)
    const now = new Date().toISOString()
    this.prep().upsert.run(item.id, JSON.stringify(item), now, now)
    this.emit({
      kind: "upsert",
      id: item.id,
      value: item,
      previous: previous ?? undefined,
    })
  }

  async remove(id: string): Promise<void> {
    const previous = await this.get(id)
    if (!previous) return
    this.prep().delete.run(id)
    this.emit({ kind: "remove", id, previous })
  }

  rowCount(): number {
    const row = this.prep().count.get() as { n?: number } | undefined
    return row?.n ?? 0
  }
}

/**
 * Open / create the SQLite database file used by SqliteNamespace handles.
 */
export function openSqliteDatabase(filePath: string): DatabaseSync {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  // SPEC §15.6: WAL mode, NORMAL sync.
  db.exec(`PRAGMA journal_mode=WAL;`)
  db.exec(`PRAGMA synchronous=NORMAL;`)
  return db
}

function sanitizeTableName(namespace: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(namespace)) {
    throw new InvalidNamespaceDataError(
      namespace,
      "namespace name must start with a letter and contain only [A-Za-z0-9_.-]",
    )
  }
  // Replace dots / dashes with underscores for the actual table name.
  return `ns_${namespace.replace(/[.-]/g, "_")}`
}

type SqliteFilterParam = string | number | null

function isSqliteFilterParam(value: unknown): value is SqliteFilterParam {
  return typeof value === "string" || typeof value === "number"
}

function safeJsonKey(namespace: string, key: string): string {
  if (!SAFE_JSON_KEY_PATTERN.test(key)) {
    throw new InvalidNamespaceDataError(namespace, `invalid JSON field name "${key}"`)
  }
  return key
}

function buildSqliteFilter<T>(filter?: Partial<T>): { where: string; params: SqliteFilterParam[] } | null {
  if (!filter) return null
  const clauses: string[] = []
  const params: SqliteFilterParam[] = []
  for (const [key, value] of Object.entries(filter)) {
    const clause = sqliteFilterClause(key, value)
    if (!clause) continue
    clauses.push(clause.where)
    params.push(...clause.params)
  }
  return clauses.length > 0 ? { where: clauses.join(" AND "), params } : null
}

function sqliteFilterClause(key: string, value: unknown): { where: string; params: SqliteFilterParam[] } | null {
  if (!isSqliteFilterValue(value)) return null
  if (key === "id") return { where: "id = ?", params: [toSqliteFilterParam(value)] }
  if (!SAFE_JSON_KEY_PATTERN.test(key)) return null

  const expression = `json_extract(value, '$.${key}')`
  if (value === null) return { where: `${expression} IS NULL`, params: [] }
  return { where: `${expression} = ?`, params: [toSqliteFilterParam(value)] }
}

function isSqliteFilterValue(value: unknown): value is string | number | boolean | null {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
}

function toSqliteFilterParam(value: string | number | boolean | null): SqliteFilterParam {
  if (value === null) return null
  return typeof value === "boolean" ? Number(value) : value
}
