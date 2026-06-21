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

const SINGLETON_ID = "__singleton"
const META_TABLE = "__synapse_meta"
const SAFE_JSON_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface SqliteBackendDeps<T> extends NamespaceBaseDeps<T> {
  /** Shared database handle. Multiple namespaces can share the same db. */
  readonly database: DatabaseSync
  readonly indexes?: readonly string[]
  readonly validate?: (data: unknown) => data is T
}

export class SqliteNamespace<T extends Record<string, unknown> & { id: string }>
  extends AbstractDataNamespace<T>
{
  private readonly database: DatabaseSync
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
    this.database = deps.database
    this.tableName = sanitizeTableName(deps.name)
    this.indexes = deps.indexes ?? []
    this.validate = deps.validate
    this.ensureSchema()
  }

  private ensureSchema(): void {
    this.database.exec(`
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
      this.database.exec(
        `CREATE INDEX IF NOT EXISTS ${indexName} ON ${this.tableName}(${expr});`,
      )
    }

    const upsertMeta = this.database.prepare(
      `INSERT INTO ${META_TABLE}(namespace, schema_version) VALUES (?, ?)
       ON CONFLICT(namespace) DO UPDATE SET schema_version=excluded.schema_version;`,
    )
    upsertMeta.run(this.name, this.schemaVersion)
  }

  private prep() {
    if (this.prepared) return this.prepared
    this.prepared = {
      upsert: this.database.prepare(
        `INSERT INTO ${this.tableName}(id, value, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;`,
      ),
      get: this.database.prepare(
        `SELECT value FROM ${this.tableName} WHERE id = ? LIMIT 1;`,
      ),
      delete: this.database.prepare(
        `DELETE FROM ${this.tableName} WHERE id = ?;`,
      ),
      list: this.database.prepare(
        `SELECT value FROM ${this.tableName} WHERE id != ? ORDER BY id;`,
      ),
      count: this.database.prepare(
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

  async count(filter?: Partial<T>): Promise<number> {
    const pushedFilter = buildSqliteFilter(filter)
    if (filter && !pushedFilter) {
      return super.count(filter)
    }
    if (!pushedFilter) {
      const row = this.database
        .prepare(`SELECT COUNT(*) as n FROM ${this.tableName} WHERE id != ?;`)
        .get(SINGLETON_ID) as { n?: number } | undefined
      return row?.n ?? 0
    }
    const statement = this.database.prepare(
      `SELECT COUNT(*) as n FROM ${this.tableName}
       WHERE id != ? AND ${pushedFilter.where};`,
    )
    const row = statement.get(SINGLETON_ID, ...pushedFilter.params) as { n?: number } | undefined
    return row?.n ?? 0
  }

  private listRows(filter?: Partial<T>): Array<{ value?: unknown }> {
    const pushedFilter = buildSqliteFilter(filter)
    if (!pushedFilter) {
      return this.prep().list.all(SINGLETON_ID) as Array<{ value?: unknown }>
    }
    const statement = this.database.prepare(
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
