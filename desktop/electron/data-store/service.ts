import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { app } from "electron"
import { copyFileSync, renameSync, statSync, unlinkSync } from "node:fs"
import path from "node:path"
import type {
  DataStoreColumnDef,
  DataStoreColumnInfo,
  DataStoreOrderBy,
  DataStoreQueryParams,
  DataStoreQueryResult,
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
  DataStoreWhereCondition,
} from "./types"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("data-store.service")

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_]*$/
const RESERVED_PREFIX = "_"
const JSON_COLUMN_TYPE = "JSON"
const VALID_COLUMN_TYPES = new Set(["TEXT", "INTEGER", "REAL", "BLOB", "JSON"])
const VALID_WHERE_OPS = new Set(["=", "!=", ">", "<", ">=", "<=", "LIKE"])
const VALID_ORDER_DIRS = new Set(["ASC", "DESC"])

function validateName(name: string, kind: "table" | "column"): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid ${kind} name "${name}": only letters, digits, underscores allowed, must not start with "_"`)
  }
  if (name.startsWith(RESERVED_PREFIX)) {
    throw new Error(`Invalid ${kind} name "${name}": names starting with "_" are reserved`)
  }
}

function validateColumnName(name: string): void {
  validateName(name, "column")
  if (name.toLowerCase() === "id") {
    throw new Error(`Column name "id" is reserved for the auto-increment primary key`)
  }
}

function validateColumnType(type: string): void {
  if (!VALID_COLUMN_TYPES.has(type.toUpperCase())) {
    throw new Error(`Invalid column type "${type}": must be one of TEXT, INTEGER, REAL, BLOB, JSON`)
  }
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function toSqlValue(v: unknown): SQLInputValue {
  if (v === null || v === undefined) return null
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") return v
  if (ArrayBuffer.isView(v)) return v as NodeJS.ArrayBufferView
  return String(v)
}

function toNumber(v: number | bigint): number {
  return typeof v === "bigint" ? Number(v) : v
}

class DataStoreService {
  private db: DatabaseSync | null = null
  private dbPath: string = ""
  private jsonColumns = new Map<string, Set<string>>()

  open(): { corrupted: boolean } {
    this.dbPath = path.join(app.getPath("userData"), "synapse-data.db")
    let corrupted = false

    try {
      this.db = new DatabaseSync(this.dbPath)
      this.db.exec("PRAGMA journal_mode=WAL")
    } catch (error) {
      throw new Error(`Failed to open database: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const result = this.db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[]
      if (result[0]?.integrity_check !== "ok") {
        throw new Error("Database integrity check failed")
      }
    } catch (error) {
      logger.warn("Database corrupted. Creating fresh database.", { error })
      corrupted = true

      try { this.db.close() } catch { /* ignore */ }

      const timestamp = Date.now()
      try {
        renameSync(this.dbPath, `${this.dbPath}.corrupt.${timestamp}`)
        const walPath = `${this.dbPath}-wal`
        const shmPath = `${this.dbPath}-shm`
        try { renameSync(walPath, `${walPath}.corrupt.${timestamp}`) } catch { /* may not exist */ }
        try { renameSync(shmPath, `${shmPath}.corrupt.${timestamp}`) } catch { /* may not exist */ }
      } catch { /* ignore */ }

      this.db = new DatabaseSync(this.dbPath)
      this.db.exec("PRAGMA journal_mode=WAL")
    }

    this.ensureSystemSchema()
    this.syncMetaTables()
    this.refreshJsonColumnCache()

    logger.info("Data store opened.", { path: this.dbPath, corrupted })
    return { corrupted }
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      logger.info("Data store closed.")
    }
  }

  private getDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("Data store is not open")
    }
    return this.db
  }

  private ensureSystemSchema(): void {
    this.getDb().exec(`
      CREATE TABLE IF NOT EXISTS "_meta_tables" (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  }

  private syncMetaTables(): void {
    const db = this.getDb()
    const actual = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name != 'sqlite_sequence'`).all() as { name: string }[])
        .map((r) => r.name),
    )
    const tracked = new Set(
      (db.prepare(`SELECT name FROM "_meta_tables"`).all() as { name: string }[])
        .map((r) => r.name),
    )

    const now = new Date().toISOString()

    for (const name of actual) {
      if (!tracked.has(name)) {
        db.prepare(`INSERT OR IGNORE INTO "_meta_tables" (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`)
          .run(name, "", now, now)
      }
    }

    for (const name of tracked) {
      if (!actual.has(name)) {
        db.prepare(`DELETE FROM "_meta_tables" WHERE name = ?`).run(name)
      }
    }
  }

  private refreshJsonColumnCache(): void {
    this.jsonColumns.clear()
    const db = this.getDb()
    const tables = db.prepare(`SELECT name FROM "_meta_tables"`).all() as { name: string }[]

    for (const { name } of tables) {
      try {
        const columns = db.prepare(`PRAGMA table_info(${q(name)})`).all() as { name: string; type: string }[]
        const jsonCols = new Set<string>()
        for (const col of columns) {
          if (col.type.toUpperCase() === JSON_COLUMN_TYPE) {
            jsonCols.add(col.name)
          }
        }
        if (jsonCols.size > 0) {
          this.jsonColumns.set(name, jsonCols)
        }
      } catch { /* table might not exist */ }
    }
  }

  private getJsonColumnsForTable(table: string): Set<string> {
    return this.jsonColumns.get(table) ?? new Set()
  }

  private assertTableExists(name: string): void {
    const db = this.getDb()
    const row = db.prepare(`SELECT COUNT(*) as count FROM "_meta_tables" WHERE name = ?`).get(name) as { count: number }
    if (row.count === 0) {
      throw new Error(`Table "${name}" not found`)
    }
  }

  listTables(): DataStoreTableInfo[] {
    const db = this.getDb()
    const tables = db.prepare(`SELECT name, description, created_at, updated_at FROM "_meta_tables" ORDER BY name`).all() as {
      name: string
      description: string
      created_at: string
      updated_at: string
    }[]

    return tables.map((t) => {
      let rowCount = 0
      try {
        const row = db.prepare(`SELECT COUNT(*) as count FROM ${q(t.name)}`).get() as { count: number }
        rowCount = row.count
      } catch { /* ignore */ }

      return {
        name: t.name,
        description: t.description,
        rowCount,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }
    })
  }

  createTable(name: string, columns: DataStoreColumnDef[], description?: string): void {
    validateName(name, "table")
    if (columns.length === 0) {
      throw new Error("At least one column is required")
    }

    const seenColumns = new Set<string>()
    for (const col of columns) {
      validateColumnName(col.name)
      validateColumnType(col.type)
      const lower = col.name.toLowerCase()
      if (seenColumns.has(lower)) {
        throw new Error(`Duplicate column name "${col.name}"`)
      }
      seenColumns.add(lower)
    }

    const db = this.getDb()
    const now = new Date().toISOString()

    const columnDefs = columns.map((col) => `${q(col.name)} ${col.type}`).join(", ")
    const createSQL = `CREATE TABLE ${q(name)} ("id" INTEGER PRIMARY KEY AUTOINCREMENT, ${columnDefs})`

    db.exec("BEGIN")
    try {
      db.exec(createSQL)
      db.prepare(`INSERT INTO "_meta_tables" (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run(name, description ?? "", now, now)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    const jsonCols = new Set<string>()
    for (const col of columns) {
      if (col.type.toUpperCase() === JSON_COLUMN_TYPE) {
        jsonCols.add(col.name)
      }
    }
    if (jsonCols.size > 0) {
      this.jsonColumns.set(name, jsonCols)
    }
  }

  dropTable(name: string): void {
    validateName(name, "table")
    this.assertTableExists(name)

    const db = this.getDb()
    db.exec("BEGIN")
    try {
      db.exec(`DROP TABLE ${q(name)}`)
      db.prepare(`DELETE FROM "_meta_tables" WHERE name = ?`).run(name)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    this.jsonColumns.delete(name)
  }

  describeTable(name: string): DataStoreTableSchema {
    this.assertTableExists(name)

    const db = this.getDb()
    const pragmaRows = db.prepare(`PRAGMA table_info(${q(name)})`).all() as {
      name: string
      type: string
      pk: number
    }[]

    const columns: DataStoreColumnInfo[] = pragmaRows.map((r) => ({
      name: r.name,
      type: r.type,
      primaryKey: r.pk === 1,
    }))

    const meta = db.prepare(`SELECT description, created_at, updated_at FROM "_meta_tables" WHERE name = ?`).get(name) as {
      description: string
      created_at: string
      updated_at: string
    }

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${q(name)}`).get() as { count: number }

    return {
      name,
      description: meta.description,
      columns,
      rowCount: countRow.count,
      createdAt: meta.created_at,
      updatedAt: meta.updated_at,
    }
  }

  addColumn(table: string, column: DataStoreColumnDef & { default?: unknown }): void {
    validateName(table, "table")
    validateColumnName(column.name)
    validateColumnType(column.type)
    this.assertTableExists(table)

    const db = this.getDb()
    let sql = `ALTER TABLE ${q(table)} ADD COLUMN ${q(column.name)} ${column.type}`
    if (column.default !== undefined) {
      const defaultVal = column.type.toUpperCase() === JSON_COLUMN_TYPE
        ? JSON.stringify(column.default)
        : column.default
      sql += ` DEFAULT ${typeof defaultVal === "string" ? `'${defaultVal.replace(/'/g, "''")}'` : defaultVal}`
    }

    db.exec("BEGIN")
    try {
      db.exec(sql)
      db.prepare(`UPDATE "_meta_tables" SET updated_at = ? WHERE name = ?`).run(new Date().toISOString(), table)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    if (column.type.toUpperCase() === JSON_COLUMN_TYPE) {
      const existing = this.jsonColumns.get(table) ?? new Set()
      existing.add(column.name)
      this.jsonColumns.set(table, existing)
    }
  }

  insert(table: string, data: Record<string, unknown>): { id: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(table)
    const keys = Object.keys(data)
    for (const k of keys) validateColumnName(k)
    const values = keys.map((k) => toSqlValue(jsonCols.has(k) ? JSON.stringify(data[k]) : data[k]))
    const placeholders = keys.map(() => "?").join(", ")
    const columnList = keys.map(q).join(", ")

    const result = db.prepare(`INSERT INTO ${q(table)} (${columnList}) VALUES (${placeholders})`).run(...values)
    return { id: toNumber(result.lastInsertRowid) }
  }

  batchInsert(table: string, rows: Record<string, unknown>[]): { ids: number[] } {
    validateName(table, "table")
    this.assertTableExists(table)
    if (rows.length === 0) return { ids: [] }

    const db = this.getDb()
    const ids: number[] = []

    db.exec("BEGIN")
    try {
      const jsonCols = this.getJsonColumnsForTable(table)
      for (const row of rows) {
        const keys = Object.keys(row)
        for (const k of keys) validateColumnName(k)
        const values = keys.map((k) => toSqlValue(jsonCols.has(k) ? JSON.stringify(row[k]) : row[k]))
        const placeholders = keys.map(() => "?").join(", ")
        const columnList = keys.map(q).join(", ")

        const result = db.prepare(`INSERT INTO ${q(table)} (${columnList}) VALUES (${placeholders})`).run(...values)
        ids.push(toNumber(result.lastInsertRowid))
      }
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    return { ids }
  }

  query(params: DataStoreQueryParams): DataStoreQueryResult {
    validateName(params.table, "table")
    this.assertTableExists(params.table)

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(params.table)
    const { whereSQL, whereParams } = this.buildWhere(params.where, jsonCols)
    const orderSQL = this.buildOrderBy(params.orderBy)
    const limit = params.limit ?? 100
    const offset = params.offset ?? 0

    const dataSQL = `SELECT * FROM ${q(params.table)}${whereSQL}${orderSQL} LIMIT ? OFFSET ?`
    const rows = db.prepare(dataSQL).all(...whereParams, limit, offset) as Record<string, unknown>[]

    const countSQL = `SELECT COUNT(*) as total FROM ${q(params.table)}${whereSQL}`
    const countRow = db.prepare(countSQL).get(...whereParams) as { total: number }

    if (jsonCols.size > 0) {
      for (const row of rows) {
        for (const col of jsonCols) {
          if (col in row && typeof row[col] === "string") {
            try { row[col] = JSON.parse(row[col] as string) } catch { /* keep as string */ }
          }
        }
      }
    }

    return { rows, total: countRow.total }
  }

  update(table: string, id: number, data: Record<string, unknown>): { affected: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(table)
    const keys = Object.keys(data)
    if (keys.length === 0) return { affected: 0 }
    for (const k of keys) validateColumnName(k)

    const setClauses = keys.map((k) => `${q(k)} = ?`).join(", ")
    const values = keys.map((k) => toSqlValue(jsonCols.has(k) ? JSON.stringify(data[k]) : data[k]))

    const result = db.prepare(`UPDATE ${q(table)} SET ${setClauses} WHERE "id" = ?`).run(...values, id)
    return { affected: toNumber(result.changes) }
  }

  delete(table: string, id: number): { affected: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const result = db.prepare(`DELETE FROM ${q(table)} WHERE "id" = ?`).run(id)
    return { affected: toNumber(result.changes) }
  }

  rawSQL(sql: string, params?: unknown[]): { rows?: Record<string, unknown>[]; changes?: number; lastInsertRowid?: number } {
    const normalized = sql.trim().toLowerCase()

    if (/\b_\w+/i.test(sql) && /\b_[a-zA-Z]\w*\b/.test(sql)) {
      throw new Error("Cannot operate on system tables (prefixed with _)")
    }
    if (/\b(attach|detach)\b/i.test(normalized)) {
      throw new Error("ATTACH and DETACH statements are not allowed")
    }

    const db = this.getDb()
    const isRead = /^(select|pragma|explain)\b/.test(normalized)
    const isDDL = /^(create\s+table|drop\s+table|alter\s+table)\b/.test(normalized)
    const sqlParams = (params ?? []).map(toSqlValue)

    if (isRead) {
      const rows = db.prepare(sql).all(...sqlParams) as Record<string, unknown>[]
      return { rows }
    }

    const result = db.prepare(sql).run(...sqlParams)

    if (isDDL) {
      this.syncMetaTables()
      this.refreshJsonColumnCache()
    }

    return { changes: toNumber(result.changes), lastInsertRowid: toNumber(result.lastInsertRowid) }
  }

  getDbSize(): number {
    try {
      return statSync(this.dbPath).size
    } catch {
      return 0
    }
  }

  getTableCount(): number {
    const db = this.getDb()
    const row = db.prepare(`SELECT COUNT(*) as count FROM "_meta_tables"`).get() as { count: number }
    return row.count
  }

  exportDatabase(targetPath: string): void {
    const db = this.getDb()
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    copyFileSync(this.dbPath, targetPath)
  }

  importDatabase(sourcePath: string): void {
    let tempDb: DatabaseSync | null = null
    try {
      tempDb = new DatabaseSync(sourcePath)
      const tables = tempDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_meta_tables'`).all()
      if (tables.length === 0) {
        throw new Error("Invalid database: _meta_tables not found")
      }
      const columns = tempDb.prepare(`PRAGMA table_info("_meta_tables")`).all() as { name: string }[]
      const colNames = new Set(columns.map((c) => c.name))
      for (const required of ["name", "description", "created_at", "updated_at"]) {
        if (!colNames.has(required)) {
          throw new Error(`Invalid database: _meta_tables missing column "${required}"`)
        }
      }
    } finally {
      tempDb?.close()
    }

    const backupPath = `${this.dbPath}.import-backup.${Date.now()}`
    const walPath = `${this.dbPath}-wal`
    const shmPath = `${this.dbPath}-shm`

    try {
      this.getDb().exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } catch { /* best effort */ }

    copyFileSync(this.dbPath, backupPath)
    this.close()

    try {
      unlinkSync(this.dbPath)
      try { unlinkSync(walPath) } catch { /* may not exist */ }
      try { unlinkSync(shmPath) } catch { /* may not exist */ }
      copyFileSync(sourcePath, this.dbPath)

      this.db = new DatabaseSync(this.dbPath)
      this.db.exec("PRAGMA journal_mode=WAL")
      this.refreshJsonColumnCache()
    } catch (error) {
      try {
        copyFileSync(backupPath, this.dbPath)
        this.db = new DatabaseSync(this.dbPath)
        this.db.exec("PRAGMA journal_mode=WAL")
        this.refreshJsonColumnCache()
      } catch (restoreError) {
        logger.error("Failed to restore backup after import failure.", { restoreError })
      }
      throw error
    } finally {
      try { unlinkSync(backupPath) } catch { /* ignore */ }
    }

    logger.info("Database imported.", { source: sourcePath })
  }

  getDbPath(): string {
    return this.dbPath
  }

  private buildWhere(where?: DataStoreWhereClause, jsonCols?: Set<string>): { whereSQL: string; whereParams: SQLInputValue[] } {
    if (!where) return { whereSQL: "", whereParams: [] }

    const conditions: string[] = []
    const params: SQLInputValue[] = []
    const jCols = jsonCols ?? new Set<string>()

    if (Array.isArray(where)) {
      for (const cond of where as DataStoreWhereCondition[]) {
        validateName(cond.field, "column")
        if (!VALID_WHERE_OPS.has(cond.op)) {
          throw new Error(`Invalid where operator "${cond.op}": must be one of =, !=, >, <, >=, <=, LIKE`)
        }
        conditions.push(`${q(cond.field)} ${cond.op} ?`)
        const val = jCols.has(cond.field) && cond.value != null && typeof cond.value === "object"
          ? JSON.stringify(cond.value)
          : cond.value
        params.push(toSqlValue(val))
      }
    } else {
      for (const [key, value] of Object.entries(where)) {
        validateName(key, "column")
        conditions.push(`${q(key)} = ?`)
        const val = jCols.has(key) && value != null && typeof value === "object"
          ? JSON.stringify(value)
          : value
        params.push(toSqlValue(val))
      }
    }

    if (conditions.length === 0) return { whereSQL: "", whereParams: [] }
    return { whereSQL: ` WHERE ${conditions.join(" AND ")}`, whereParams: params }
  }

  private buildOrderBy(orderBy?: DataStoreOrderBy): string {
    if (!orderBy) return ""
    if (typeof orderBy === "string") {
      validateName(orderBy, "column")
      return ` ORDER BY ${q(orderBy)} ASC`
    }
    validateName(orderBy.field, "column")
    const dir = orderBy.dir.toUpperCase()
    if (!VALID_ORDER_DIRS.has(dir)) {
      throw new Error(`Invalid order direction "${orderBy.dir}": must be "asc" or "desc"`)
    }
    return ` ORDER BY ${q(orderBy.field)} ${dir}`
  }
}

const dataStoreService = new DataStoreService()

export { dataStoreService }
