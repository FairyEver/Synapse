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

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
const RESERVED_PREFIX = "_"
const JSON_COLUMN_TYPE = "JSON"
const BOOLEAN_COLUMN_TYPE = "BOOLEAN"
const DATE_COLUMN_TYPE = "DATE"
const DATETIME_COLUMN_TYPE = "DATETIME"
const ENUM_COLUMN_TYPE = "ENUM"
const MULTI_ENUM_COLUMN_TYPE = "MULTI_ENUM"
const VALID_COLUMN_TYPES = new Set(["TEXT", "INTEGER", "REAL", "BLOB", "JSON", "DATE", "DATETIME", "BOOLEAN", "ENUM", "MULTI_ENUM"])
const VALID_WHERE_OPS = new Set(["=", "!=", ">", "<", ">=", "<=", "LIKE", "CONTAINS"])
const VALID_ORDER_DIRS = new Set(["ASC", "DESC"])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/

function validateName(name: string, kind: "table" | "column"): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid ${kind} name "${name}": must start with a letter, only letters, digits, underscores allowed`)
  }
  if (name.startsWith(RESERVED_PREFIX)) {
    throw new Error(`Invalid ${kind} name "${name}": names starting with "_" are reserved`)
  }
}

function validateColumnName(name: string): void {
  validateName(name, "column")
  const lower = name.toLowerCase()
  if (lower === "id" || lower === "created_at" || lower === "updated_at") {
    throw new Error(`Column name "${name}" is reserved for system use`)
  }
}

function validateColumnType(type: string): void {
  if (!VALID_COLUMN_TYPES.has(type.toUpperCase())) {
    throw new Error(`Invalid column type "${type}": must be one of TEXT, INTEGER, REAL, BLOB, JSON, ENUM, MULTI_ENUM`)
  }
}

const MULTI_ENUM_NAME_SIGNALS = ["tags", "labels", "categories", "标签", "分类", "类别"]
const ENUM_NAME_SIGNALS = ["status", "priority", "level", "role", "severity", "gender", "优先级", "级别", "状态", "角色", "等级", "性别"]
const ENUM_OR_MULTI_NAME_SIGNALS = ["category", "type", "kind", "tag", "label", "种类"]
const BOOLEAN_NAME_EXACT = ["done", "enabled", "active", "visible", "archived", "deleted", "published", "completed", "locked", "pinned", "starred", "favorite", "read"]
const BOOLEAN_NAME_PREFIXES = ["is_", "has_", "can_", "should_"]
const BOOLEAN_NAME_PREFIXES_CN = ["是否"]

function assertSemanticallyCorrectColumn(col: DataStoreColumnDef): void {
  const type = col.type.toUpperCase()
  const lower = col.name.toLowerCase()

  if (col.enumValues && col.enumValues.length > 0 && type !== ENUM_COLUMN_TYPE && type !== MULTI_ENUM_COLUMN_TYPE) {
    throw new Error(
      `Column "${col.name}" has enumValues but type is ${type}. enumValues only applies to ENUM (single-choice) or MULTI_ENUM (multi-select). Change type to "ENUM" or "MULTI_ENUM" based on whether the user wants single or multiple selection.`,
    )
  }

  if ((type === "JSON" || type === "TEXT") && (MULTI_ENUM_NAME_SIGNALS.includes(lower) || MULTI_ENUM_NAME_SIGNALS.includes(col.name))) {
    throw new Error(
      `Column "${col.name}" is a multi-select field. Use type="MULTI_ENUM" with enumValues=[...allowed values...], not ${type}. Example: { name: "${col.name}", type: "MULTI_ENUM", enumValues: ["选项1", "选项2"] }. If the user genuinely needs free-form data without a fixed value set, rename the column to avoid multi-select keywords.`,
    )
  }

  if (type === "TEXT" && (ENUM_NAME_SIGNALS.includes(lower) || ENUM_NAME_SIGNALS.includes(col.name))) {
    throw new Error(
      `Column "${col.name}" is a single-choice enum field. Use type="ENUM" with enumValues=[...allowed values...], not TEXT. Example: { name: "${col.name}", type: "ENUM", enumValues: ["值1", "值2", "值3"] }.`,
    )
  }

  if ((type === "JSON" || type === "TEXT") && ENUM_OR_MULTI_NAME_SIGNALS.includes(lower)) {
    throw new Error(
      `Column "${col.name}" looks like an enum-like field. Use type="ENUM" (if each row has ONE value) or type="MULTI_ENUM" (if each row can hold multiple values) with enumValues=[...allowed values...], not ${type}.`,
    )
  }

  if (type === "INTEGER") {
    const looksBool =
      BOOLEAN_NAME_EXACT.includes(lower)
      || BOOLEAN_NAME_PREFIXES.some((p) => lower.startsWith(p))
      || BOOLEAN_NAME_PREFIXES_CN.some((p) => col.name.startsWith(p))
    if (looksBool) {
      throw new Error(
        `Column "${col.name}" is a boolean field. Use type="BOOLEAN" (stored as 0/1, returned as true/false), not INTEGER.`,
      )
    }
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

function toBooleanInt(v: unknown): number {
  if (v === true || v === 1 || v === "true" || v === "1") return 1
  if (v === false || v === 0 || v === "false" || v === "0" || v === null || v === undefined) return 0
  throw new Error(`Invalid boolean value: ${JSON.stringify(v)}. Expected true/false, 1/0, "true"/"false"`)
}

function validateDateString(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  if (!DATE_PATTERN.test(s)) {
    throw new Error(`Invalid date format: "${s}". Expected YYYY-MM-DD`)
  }
  const [y, m, d] = s.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`Invalid date: "${s}"`)
  }
  return s
}

function validateDateTimeString(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  if (!DATETIME_PATTERN.test(s)) {
    throw new Error(`Invalid datetime format: "${s}". Expected YYYY-MM-DD HH:mm:ss`)
  }
  const normalized = s.replace("T", " ")
  const [datePart, timePart] = normalized.split(" ")
  const [y, m, d] = datePart.split("-").map(Number)
  const [hh, mm, ss] = timePart.split(":").map(Number)
  const date = new Date(y, m - 1, d, hh, mm, ss)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d
    || date.getHours() !== hh || date.getMinutes() !== mm || date.getSeconds() !== ss) {
    throw new Error(`Invalid datetime: "${s}"`)
  }
  return normalized
}

class DataStoreService {
  private db: DatabaseSync | null = null
  private dbPath: string = ""
  private jsonColumns = new Map<string, Set<string>>()
  private booleanColumns = new Map<string, Set<string>>()
  private dateColumns = new Map<string, Set<string>>()
  private datetimeColumns = new Map<string, Set<string>>()
  private enumColumns = new Map<string, Map<string, string[]>>()
  private multiEnumColumns = new Map<string, Set<string>>()

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
    const db = this.getDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_meta_tables" (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_meta_columns" (
        table_name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (table_name, column_name)
      )
    `)
    const cols = db.prepare(`PRAGMA table_info("_meta_columns")`).all() as { name: string }[]
    const colNames = new Set(cols.map((c) => c.name))
    if (!colNames.has("enum_values")) {
      db.exec(`ALTER TABLE "_meta_columns" ADD COLUMN enum_values TEXT NOT NULL DEFAULT ''`)
    }
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
        db.prepare(`DELETE FROM "_meta_columns" WHERE table_name = ?`).run(name)
      }
    }
  }

  private refreshJsonColumnCache(): void {
    this.jsonColumns.clear()
    this.booleanColumns.clear()
    this.dateColumns.clear()
    this.datetimeColumns.clear()
    this.enumColumns.clear()
    this.multiEnumColumns.clear()
    const db = this.getDb()
    const tables = db.prepare(`SELECT name FROM "_meta_tables"`).all() as { name: string }[]

    for (const { name } of tables) {
      try {
        const columns = db.prepare(`PRAGMA table_info(${q(name)})`).all() as { name: string; type: string }[]
        const jsonCols = new Set<string>()
        const boolCols = new Set<string>()
        const dateCols = new Set<string>()
        const dtCols = new Set<string>()
        const enumCols = new Map<string, string[]>()
        const multiEnumCols = new Set<string>()
        for (const col of columns) {
          const upper = col.type.toUpperCase()
          if (upper === JSON_COLUMN_TYPE) jsonCols.add(col.name)
          else if (upper === BOOLEAN_COLUMN_TYPE) boolCols.add(col.name)
          else if (upper === DATETIME_COLUMN_TYPE) dtCols.add(col.name)
          else if (upper === DATE_COLUMN_TYPE) dateCols.add(col.name)
          else if (upper === ENUM_COLUMN_TYPE) enumCols.set(col.name, [])
          else if (upper === MULTI_ENUM_COLUMN_TYPE) { enumCols.set(col.name, []); multiEnumCols.add(col.name) }
        }
        if (jsonCols.size > 0) this.jsonColumns.set(name, jsonCols)
        if (boolCols.size > 0) this.booleanColumns.set(name, boolCols)
        if (dateCols.size > 0) this.dateColumns.set(name, dateCols)
        if (dtCols.size > 0) this.datetimeColumns.set(name, dtCols)
        if (enumCols.size > 0) this.enumColumns.set(name, enumCols)
        if (multiEnumCols.size > 0) this.multiEnumColumns.set(name, multiEnumCols)
      } catch { /* table might not exist */ }
    }

    try {
      const metaRows = db.prepare(`SELECT table_name, column_name, enum_values FROM "_meta_columns" WHERE enum_values != ''`).all() as {
        table_name: string
        column_name: string
        enum_values: string
      }[]
      for (const row of metaRows) {
        try {
          const values = JSON.parse(row.enum_values) as string[]
          if (!Array.isArray(values)) continue
          let tableMap = this.enumColumns.get(row.table_name)
          if (!tableMap) {
            tableMap = new Map()
            this.enumColumns.set(row.table_name, tableMap)
          }
          tableMap.set(row.column_name, values)
        } catch { /* invalid JSON, skip */ }
      }
    } catch { /* _meta_columns might not have enum_values column yet */ }
  }

  private getJsonColumnsForTable(table: string): Set<string> {
    return this.jsonColumns.get(table) ?? new Set()
  }

  private getBooleanColumnsForTable(table: string): Set<string> {
    return this.booleanColumns.get(table) ?? new Set()
  }

  private getDateColumnsForTable(table: string): Set<string> {
    return this.dateColumns.get(table) ?? new Set()
  }

  private getDatetimeColumnsForTable(table: string): Set<string> {
    return this.datetimeColumns.get(table) ?? new Set()
  }

  private getEnumColumnsForTable(table: string): Map<string, string[]> {
    return this.enumColumns.get(table) ?? new Map()
  }

  private getMultiEnumColumnsForTable(table: string): Set<string> {
    return this.multiEnumColumns.get(table) ?? new Set()
  }

  private validateEnumValue(key: string, value: unknown, enumCols: Map<string, string[]>): void {
    const allowed = enumCols.get(key)
    if (!allowed) return
    if (value === null || value === undefined || value === "") return
    const s = String(value)
    if (!allowed.includes(s)) {
      throw new Error(`Invalid value "${s}" for ENUM column "${key}". Allowed: ${allowed.join(", ")}`)
    }
  }

  private validateMultiEnumValue(key: string, value: unknown, enumCols: Map<string, string[]>): void {
    const allowed = enumCols.get(key)
    if (!allowed) return
    if (value === null || value === undefined) return
    if (!Array.isArray(value)) {
      throw new Error(`MULTI_ENUM column "${key}" requires an array value`)
    }
    for (const item of value) {
      const s = String(item)
      if (!allowed.includes(s)) {
        throw new Error(`Invalid value "${s}" for MULTI_ENUM column "${key}". Allowed: ${allowed.join(", ")}`)
      }
    }
  }

  private convertWriteValue(
    key: string,
    value: unknown,
    jsonCols: Set<string>,
    boolCols: Set<string>,
    dateCols: Set<string>,
    dtCols: Set<string>,
    multiEnumCols?: Set<string>,
  ): SQLInputValue {
    if (multiEnumCols?.has(key)) return toSqlValue(JSON.stringify(value))
    if (jsonCols.has(key)) return toSqlValue(JSON.stringify(value))
    if (boolCols.has(key)) return toBooleanInt(value)
    if (dateCols.has(key) && value !== null && value !== undefined && value !== "") {
      return validateDateString(value)
    }
    if (dtCols.has(key) && value !== null && value !== undefined && value !== "") {
      return validateDateTimeString(value)
    }
    return toSqlValue(value)
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
      const upperType = col.type.toUpperCase()
      if (upperType === ENUM_COLUMN_TYPE || upperType === MULTI_ENUM_COLUMN_TYPE) {
        if (!col.enumValues || col.enumValues.length === 0) {
          throw new Error(`${upperType} column "${col.name}" requires at least one value in enumValues`)
        }
      }
      assertSemanticallyCorrectColumn(col)
    }

    const db = this.getDb()
    const now = new Date().toISOString()

    const columnDefs = columns.map((col) => `${q(col.name)} ${col.type}`).join(", ")
    const createSQL = `CREATE TABLE ${q(name)} ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "created_at" TEXT NOT NULL DEFAULT '', "updated_at" TEXT NOT NULL DEFAULT '', ${columnDefs})`

    db.exec("BEGIN")
    try {
      db.exec(createSQL)
      db.prepare(`INSERT INTO "_meta_tables" (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run(name, description ?? "", now, now)
      for (const col of columns) {
        const hasDesc = !!col.description
        const hasEnum = (col.type.toUpperCase() === ENUM_COLUMN_TYPE || col.type.toUpperCase() === MULTI_ENUM_COLUMN_TYPE) && col.enumValues
        if (hasDesc || hasEnum) {
          db.prepare(`INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, description, enum_values) VALUES (?, ?, ?, ?)`)
            .run(name, col.name, col.description ?? "", hasEnum ? JSON.stringify(col.enumValues) : "")
        }
      }
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    const jsonCols = new Set<string>()
    const boolCols = new Set<string>()
    const dateCols = new Set<string>()
    const dtCols = new Set<string>()
    const enumCols = new Map<string, string[]>()
    const multiEnumCols = new Set<string>()
    for (const col of columns) {
      const upper = col.type.toUpperCase()
      if (upper === JSON_COLUMN_TYPE) jsonCols.add(col.name)
      else if (upper === BOOLEAN_COLUMN_TYPE) boolCols.add(col.name)
      else if (upper === DATETIME_COLUMN_TYPE) dtCols.add(col.name)
      else if (upper === DATE_COLUMN_TYPE) dateCols.add(col.name)
      else if (upper === ENUM_COLUMN_TYPE && col.enumValues) enumCols.set(col.name, col.enumValues)
      else if (upper === MULTI_ENUM_COLUMN_TYPE && col.enumValues) { enumCols.set(col.name, col.enumValues); multiEnumCols.add(col.name) }
    }
    if (jsonCols.size > 0) this.jsonColumns.set(name, jsonCols)
    if (boolCols.size > 0) this.booleanColumns.set(name, boolCols)
    if (dateCols.size > 0) this.dateColumns.set(name, dateCols)
    if (dtCols.size > 0) this.datetimeColumns.set(name, dtCols)
    if (enumCols.size > 0) this.enumColumns.set(name, enumCols)
    if (multiEnumCols.size > 0) this.multiEnumColumns.set(name, multiEnumCols)
  }

  dropTable(name: string): void {
    validateName(name, "table")
    this.assertTableExists(name)

    const db = this.getDb()
    db.exec("BEGIN")
    try {
      db.exec(`DROP TABLE ${q(name)}`)
      db.prepare(`DELETE FROM "_meta_tables" WHERE name = ?`).run(name)
      db.prepare(`DELETE FROM "_meta_columns" WHERE table_name = ?`).run(name)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    this.jsonColumns.delete(name)
    this.booleanColumns.delete(name)
    this.dateColumns.delete(name)
    this.datetimeColumns.delete(name)
    this.enumColumns.delete(name)
    this.multiEnumColumns.delete(name)
  }

  describeTable(name: string): DataStoreTableSchema {
    this.assertTableExists(name)

    const db = this.getDb()
    const pragmaRows = db.prepare(`PRAGMA table_info(${q(name)})`).all() as {
      name: string
      type: string
      pk: number
    }[]

    const colMetaRows = db.prepare(`SELECT column_name, description, enum_values FROM "_meta_columns" WHERE table_name = ?`).all(name) as {
      column_name: string
      description: string
      enum_values: string
    }[]
    const colDescMap = new Map(colMetaRows.map((r) => [r.column_name, r.description]))
    const colEnumMap = new Map<string, string[]>()
    for (const r of colMetaRows) {
      if (r.enum_values) {
        try {
          const vals = JSON.parse(r.enum_values)
          if (Array.isArray(vals)) colEnumMap.set(r.column_name, vals)
        } catch { /* skip */ }
      }
    }

    const SYSTEM_COLUMNS = new Set(["id", "created_at", "updated_at"])

    const columns: DataStoreColumnInfo[] = pragmaRows.map((r) => {
      const info: DataStoreColumnInfo = {
        name: r.name,
        type: r.type,
        primaryKey: r.pk === 1,
        description: colDescMap.get(r.name) ?? "",
      }
      if (SYSTEM_COLUMNS.has(r.name)) info.system = true
      const ev = colEnumMap.get(r.name)
      if (ev) info.enumValues = ev
      return info
    })

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
    assertSemanticallyCorrectColumn(column)
    this.assertTableExists(table)

    const upper = column.type.toUpperCase()
    const isEnum = upper === ENUM_COLUMN_TYPE
    const isMultiEnum = upper === MULTI_ENUM_COLUMN_TYPE
    if (isEnum || isMultiEnum) {
      if (!column.enumValues || column.enumValues.length === 0) {
        throw new Error(`${upper} column "${column.name}" requires at least one value in enumValues`)
      }
      if (column.default !== undefined && column.default !== null && column.default !== "") {
        if (isMultiEnum) {
          if (!Array.isArray(column.default)) {
            throw new Error(`Default value for MULTI_ENUM column "${column.name}" must be an array`)
          }
          for (const v of column.default as unknown[]) {
            if (!column.enumValues.includes(String(v))) {
              throw new Error(`Default value "${v}" is not in enumValues: ${column.enumValues.join(", ")}`)
            }
          }
        } else {
          if (!column.enumValues.includes(String(column.default))) {
            throw new Error(`Default value "${column.default}" is not in enumValues: ${column.enumValues.join(", ")}`)
          }
        }
      }
    }

    const db = this.getDb()
    let sql = `ALTER TABLE ${q(table)} ADD COLUMN ${q(column.name)} ${column.type}`
    if (column.default !== undefined) {
      const defaultVal = upper === JSON_COLUMN_TYPE
        ? JSON.stringify(column.default)
        : column.default
      sql += ` DEFAULT ${typeof defaultVal === "string" ? `'${defaultVal.replace(/'/g, "''")}'` : defaultVal}`
    }

    db.exec("BEGIN")
    try {
      db.exec(sql)
      db.prepare(`UPDATE "_meta_tables" SET updated_at = ? WHERE name = ?`).run(new Date().toISOString(), table)
      if (column.description || isEnum || isMultiEnum) {
        db.prepare(`INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, description, enum_values) VALUES (?, ?, ?, ?)`)
          .run(table, column.name, column.description ?? "", (isEnum || isMultiEnum) ? JSON.stringify(column.enumValues) : "")
      }
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    if (upper === JSON_COLUMN_TYPE) {
      const existing = this.jsonColumns.get(table) ?? new Set()
      existing.add(column.name)
      this.jsonColumns.set(table, existing)
    } else if (upper === BOOLEAN_COLUMN_TYPE) {
      const existing = this.booleanColumns.get(table) ?? new Set()
      existing.add(column.name)
      this.booleanColumns.set(table, existing)
    } else if (upper === DATE_COLUMN_TYPE) {
      const existing = this.dateColumns.get(table) ?? new Set()
      existing.add(column.name)
      this.dateColumns.set(table, existing)
    } else if (upper === DATETIME_COLUMN_TYPE) {
      const existing = this.datetimeColumns.get(table) ?? new Set()
      existing.add(column.name)
      this.datetimeColumns.set(table, existing)
    } else if (isEnum && column.enumValues) {
      const existing = this.enumColumns.get(table) ?? new Map()
      existing.set(column.name, column.enumValues)
      this.enumColumns.set(table, existing)
    } else if (isMultiEnum && column.enumValues) {
      const existingEnum = this.enumColumns.get(table) ?? new Map()
      existingEnum.set(column.name, column.enumValues)
      this.enumColumns.set(table, existingEnum)
      const existingMulti = this.multiEnumColumns.get(table) ?? new Set()
      existingMulti.add(column.name)
      this.multiEnumColumns.set(table, existingMulti)
    }
  }

  updateColumnDescription(table: string, column: string, description: string): void {
    validateName(table, "table")
    validateColumnName(column)
    this.assertTableExists(table)

    const db = this.getDb()
    db.prepare(`INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, description, enum_values) VALUES (?, ?, ?, COALESCE((SELECT enum_values FROM "_meta_columns" WHERE table_name = ? AND column_name = ?), ''))`)
      .run(table, column, description, table, column)
  }

  updateColumnEnumValues(table: string, column: string, values: string[]): void {
    validateName(table, "table")
    validateColumnName(column)
    this.assertTableExists(table)
    if (values.length === 0) {
      throw new Error("ENUM values list cannot be empty")
    }

    const db = this.getDb()
    db.prepare(`INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, description, enum_values) VALUES (?, ?, COALESCE((SELECT description FROM "_meta_columns" WHERE table_name = ? AND column_name = ?), ''), ?)`)
      .run(table, column, table, column, JSON.stringify(values))

    const existing = this.enumColumns.get(table) ?? new Map()
    existing.set(column, values)
    this.enumColumns.set(table, existing)
  }

  insert(table: string, data: Record<string, unknown>): { id: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(table)
    const boolCols = this.getBooleanColumnsForTable(table)
    const dateCols = this.getDateColumnsForTable(table)
    const dtCols = this.getDatetimeColumnsForTable(table)
    const enumCols = this.getEnumColumnsForTable(table)
    const multiEnumCols = this.getMultiEnumColumnsForTable(table)
    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "created_at" && k !== "updated_at"))
    const now = new Date().toISOString()
    const withTimestamps: Record<string, unknown> = { created_at: now, updated_at: now, ...filtered }
    const keys = Object.keys(withTimestamps)
    for (const k of keys) {
      if (k !== "created_at" && k !== "updated_at") {
        validateColumnName(k)
        if (multiEnumCols.has(k)) {
          this.validateMultiEnumValue(k, withTimestamps[k], enumCols)
        } else {
          this.validateEnumValue(k, withTimestamps[k], enumCols)
        }
      }
    }
    const values = keys.map((k) => k === "created_at" || k === "updated_at" ? withTimestamps[k] as string : this.convertWriteValue(k, withTimestamps[k], jsonCols, boolCols, dateCols, dtCols, multiEnumCols))
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
      const boolCols = this.getBooleanColumnsForTable(table)
      const dateCols = this.getDateColumnsForTable(table)
      const dtCols = this.getDatetimeColumnsForTable(table)
      const enumCols = this.getEnumColumnsForTable(table)
      const multiEnumCols = this.getMultiEnumColumnsForTable(table)
      for (const row of rows) {
        const filtered = Object.fromEntries(Object.entries(row).filter(([k]) => k !== "created_at" && k !== "updated_at"))
        const now = new Date().toISOString()
        const withTimestamps: Record<string, unknown> = { created_at: now, updated_at: now, ...filtered }
        const keys = Object.keys(withTimestamps)
        for (const k of keys) {
          if (k !== "created_at" && k !== "updated_at") {
            validateColumnName(k)
            if (multiEnumCols.has(k)) {
              this.validateMultiEnumValue(k, withTimestamps[k], enumCols)
            } else {
              this.validateEnumValue(k, withTimestamps[k], enumCols)
            }
          }
        }
        const values = keys.map((k) => k === "created_at" || k === "updated_at" ? withTimestamps[k] as string : this.convertWriteValue(k, withTimestamps[k], jsonCols, boolCols, dateCols, dtCols, multiEnumCols))
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
    const boolCols = this.getBooleanColumnsForTable(params.table)
    const multiEnumCols = this.getMultiEnumColumnsForTable(params.table)
    const { whereSQL, whereParams } = this.buildWhere(params.where, jsonCols, boolCols, multiEnumCols)
    const orderSQL = this.buildOrderBy(params.orderBy)
    const limit = params.limit ?? 100
    const offset = params.offset ?? 0

    const dataSQL = `SELECT * FROM ${q(params.table)}${whereSQL}${orderSQL} LIMIT ? OFFSET ?`
    const rows = db.prepare(dataSQL).all(...whereParams, limit, offset) as Record<string, unknown>[]

    const countSQL = `SELECT COUNT(*) as total FROM ${q(params.table)}${whereSQL}`
    const countRow = db.prepare(countSQL).get(...whereParams) as { total: number }

    for (const row of rows) {
      for (const col of jsonCols) {
        if (col in row && typeof row[col] === "string") {
          try { row[col] = JSON.parse(row[col] as string) } catch { /* keep as string */ }
        }
      }
      for (const col of boolCols) {
        if (col in row) {
          row[col] = row[col] === 1 || row[col] === true
        }
      }
      for (const col of multiEnumCols) {
        if (col in row && typeof row[col] === "string") {
          try { row[col] = JSON.parse(row[col] as string) } catch { /* keep as string */ }
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
    const boolCols = this.getBooleanColumnsForTable(table)
    const dateCols = this.getDateColumnsForTable(table)
    const dtCols = this.getDatetimeColumnsForTable(table)
    const enumCols = this.getEnumColumnsForTable(table)
    const multiEnumCols = this.getMultiEnumColumnsForTable(table)
    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "created_at" && k !== "updated_at"))
    const withTimestamp: Record<string, unknown> = { ...filtered, updated_at: new Date().toISOString() }
    const keys = Object.keys(withTimestamp)
    if (keys.length === 0) return { affected: 0 }
    for (const k of keys) {
      if (k !== "updated_at") {
        validateColumnName(k)
        if (multiEnumCols.has(k)) {
          this.validateMultiEnumValue(k, withTimestamp[k], enumCols)
        } else {
          this.validateEnumValue(k, withTimestamp[k], enumCols)
        }
      }
    }

    const setClauses = keys.map((k) => `${q(k)} = ?`).join(", ")
    const values = keys.map((k) => k === "updated_at" ? withTimestamp[k] as string : this.convertWriteValue(k, withTimestamp[k], jsonCols, boolCols, dateCols, dtCols, multiEnumCols))

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

  updateWhere(table: string, where: DataStoreWhereClause, data: Record<string, unknown>): { affected: number; ids: number[] } {
    validateName(table, "table")
    this.assertTableExists(table)

    const whereEmpty = !where
      || (Array.isArray(where) ? where.length === 0 : Object.keys(where).length === 0)
    if (whereEmpty) {
      throw new Error("updateWhere requires a non-empty where clause. Use 'update' to target a single row by id.")
    }

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(table)
    const boolCols = this.getBooleanColumnsForTable(table)
    const dateCols = this.getDateColumnsForTable(table)
    const dtCols = this.getDatetimeColumnsForTable(table)
    const enumCols = this.getEnumColumnsForTable(table)
    const multiEnumCols = this.getMultiEnumColumnsForTable(table)

    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "created_at" && k !== "updated_at"))
    const withTimestamp: Record<string, unknown> = { ...filtered, updated_at: new Date().toISOString() }
    const keys = Object.keys(withTimestamp)
    if (keys.length === 0) return { affected: 0, ids: [] }
    for (const k of keys) {
      if (k !== "updated_at") {
        validateColumnName(k)
        if (multiEnumCols.has(k)) {
          this.validateMultiEnumValue(k, withTimestamp[k], enumCols)
        } else {
          this.validateEnumValue(k, withTimestamp[k], enumCols)
        }
      }
    }

    const { whereSQL, whereParams } = this.buildWhere(where, jsonCols, boolCols, multiEnumCols)
    const setClauses = keys.map((k) => `${q(k)} = ?`).join(", ")
    const values = keys.map((k) => k === "updated_at" ? withTimestamp[k] as string : this.convertWriteValue(k, withTimestamp[k], jsonCols, boolCols, dateCols, dtCols, multiEnumCols))

    db.exec("BEGIN")
    try {
      const idRows = db.prepare(`SELECT "id" FROM ${q(table)}${whereSQL}`).all(...whereParams) as { id: number | bigint }[]
      const ids = idRows.map((r) => toNumber(r.id))
      if (ids.length === 0) {
        db.exec("COMMIT")
        return { affected: 0, ids: [] }
      }
      const inPlaceholders = ids.map(() => "?").join(", ")
      db.prepare(`UPDATE ${q(table)} SET ${setClauses} WHERE "id" IN (${inPlaceholders})`).run(...values, ...ids)
      db.exec("COMMIT")
      return { affected: ids.length, ids }
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }

  deleteWhere(table: string, where: DataStoreWhereClause): { affected: number; ids: number[] } {
    validateName(table, "table")
    this.assertTableExists(table)

    const whereEmpty = !where
      || (Array.isArray(where) ? where.length === 0 : Object.keys(where).length === 0)
    if (whereEmpty) {
      throw new Error("deleteWhere requires a non-empty where clause. Use 'delete' to target a single row by id, or drop and recreate the table to clear it.")
    }

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(table)
    const boolCols = this.getBooleanColumnsForTable(table)
    const multiEnumCols = this.getMultiEnumColumnsForTable(table)
    const { whereSQL, whereParams } = this.buildWhere(where, jsonCols, boolCols, multiEnumCols)

    db.exec("BEGIN")
    try {
      const idRows = db.prepare(`SELECT "id" FROM ${q(table)}${whereSQL}`).all(...whereParams) as { id: number | bigint }[]
      const ids = idRows.map((r) => toNumber(r.id))
      if (ids.length === 0) {
        db.exec("COMMIT")
        return { affected: 0, ids: [] }
      }
      const inPlaceholders = ids.map(() => "?").join(", ")
      db.prepare(`DELETE FROM ${q(table)} WHERE "id" IN (${inPlaceholders})`).run(...ids)
      db.exec("COMMIT")
      return { affected: ids.length, ids }
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
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
      this.ensureSystemSchema()
      this.refreshJsonColumnCache()
    } catch (error) {
      try {
        copyFileSync(backupPath, this.dbPath)
        this.db = new DatabaseSync(this.dbPath)
        this.db.exec("PRAGMA journal_mode=WAL")
        this.ensureSystemSchema()
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

  private buildWhere(where?: DataStoreWhereClause, jsonCols?: Set<string>, boolCols?: Set<string>, multiEnumCols?: Set<string>): { whereSQL: string; whereParams: SQLInputValue[] } {
    if (!where) return { whereSQL: "", whereParams: [] }

    const conditions: string[] = []
    const params: SQLInputValue[] = []
    const jCols = jsonCols ?? new Set<string>()
    const bCols = boolCols ?? new Set<string>()
    const mCols = multiEnumCols ?? new Set<string>()

    if (Array.isArray(where)) {
      for (const cond of where as DataStoreWhereCondition[]) {
        validateName(cond.field, "column")
        if (!VALID_WHERE_OPS.has(cond.op)) {
          throw new Error(`Invalid where operator "${cond.op}": must be one of =, !=, >, <, >=, <=, LIKE, CONTAINS`)
        }
        if (cond.op === "CONTAINS") {
          if (!mCols.has(cond.field)) {
            throw new Error(`CONTAINS operator is only supported on MULTI_ENUM columns. Column "${cond.field}" is not MULTI_ENUM.`)
          }
          conditions.push(`EXISTS (SELECT 1 FROM json_each(${q(cond.field)}) WHERE value = ?)`)
          params.push(toSqlValue(cond.value))
          continue
        }
        conditions.push(`${q(cond.field)} ${cond.op} ?`)
        if (bCols.has(cond.field)) {
          params.push(toBooleanInt(cond.value))
        } else {
          const val = jCols.has(cond.field) && cond.value != null && typeof cond.value === "object"
            ? JSON.stringify(cond.value)
            : cond.value
          params.push(toSqlValue(val))
        }
      }
    } else {
      for (const [key, value] of Object.entries(where)) {
        validateName(key, "column")
        conditions.push(`${q(key)} = ?`)
        if (bCols.has(key)) {
          params.push(toBooleanInt(value))
        } else {
          const val = jCols.has(key) && value != null && typeof value === "object"
            ? JSON.stringify(value)
            : value
          params.push(toSqlValue(val))
        }
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
