import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { app } from "electron"
import { copyFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs"
import path from "node:path"
import type {
  Column,
  ColumnKind,
  DataStoreOrderBy,
  DataStoreQueryParams,
  DataStoreQueryResult,
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
  DataStoreWhereCondition,
} from "./types"
import {
  COLUMN_KINDS,
  affinityToKind,
  isBooleanKind,
  isChoiceKind,
  isColumnKind,
  isDateKind,
  isJsonSerializedKind,
  isMultiChoiceKind,
  isTimestampKind,
  kindToAffinity,
} from "./column-kind"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("data-store.service")

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/
const RESERVED_PREFIX = "_"
const VALID_WHERE_OPS = new Set(["=", "!=", ">", "<", ">=", "<=", "LIKE", "CONTAINS"])
const VALID_ORDER_DIRS = new Set(["ASC", "DESC"])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/

function isWhereGroup(where: DataStoreWhereClause): where is { combinator: "all" | "any"; conditions: DataStoreWhereCondition[] } {
  return typeof where === "object"
    && where !== null
    && "combinator" in where
    && "conditions" in where
    && Array.isArray(where.conditions)
}

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

function validateColumnKind(kind: unknown): asserts kind is ColumnKind {
  if (typeof kind !== "string" || !isColumnKind(kind)) {
    throw new Error(`Invalid column kind "${String(kind)}": must be one of ${COLUMN_KINDS.join(", ")}`)
  }
}

function validateChoicesConsistency(col: Column): void {
  if (isChoiceKind(col.kind)) {
    if (!Array.isArray(col.choices) || col.choices.length === 0) {
      throw new Error(`kind="${col.kind}" column "${col.name}" requires non-empty choices`)
    }
    const invalid = col.choices.find((choice) => typeof choice !== "string" || choice.length === 0)
    if (invalid !== undefined) {
      throw new Error(`kind="${col.kind}" column "${col.name}" choices must be non-empty strings`)
    }
    return
  }

  if (col.choices !== undefined) {
    throw new Error(`Column "${col.name}" has choices but kind="${col.kind}". choices only applies to single_choice or multi_choice`)
  }
}

const MULTI_CHOICE_NAME_HINTS = ["tags", "labels", "categories", "标签", "分类", "类别"]
const SINGLE_CHOICE_NAME_HINTS = ["status", "priority", "level", "role", "severity", "gender", "优先级", "级别", "状态", "角色", "等级", "性别"]
const CHOICE_AMBIGUOUS_NAME_HINTS = ["category", "type", "kind", "tag", "label", "种类"]
const BOOLEAN_NAME_EXACT = ["done", "enabled", "active", "visible", "archived", "deleted", "published", "completed", "locked", "pinned", "starred", "favorite", "read"]
const BOOLEAN_NAME_PREFIXES = ["is_", "has_", "can_", "should_"]
const BOOLEAN_NAME_PREFIXES_CN = ["是否"]

function assertSemanticallyCorrectColumn(col: Column): void {
  const lower = col.name.toLowerCase()

  if ((col.kind === "json" || col.kind === "text") && (MULTI_CHOICE_NAME_HINTS.includes(lower) || MULTI_CHOICE_NAME_HINTS.includes(col.name))) {
    throw new Error(
      `Column "${col.name}" is a multi-select field. Use kind="multi_choice" with choices=[...].`,
    )
  }

  if ((col.kind === "json" || col.kind === "text") && (SINGLE_CHOICE_NAME_HINTS.includes(lower) || SINGLE_CHOICE_NAME_HINTS.includes(col.name))) {
    throw new Error(
      `Column "${col.name}" is a single-choice field. Use kind="single_choice" with choices=[...].`,
    )
  }

  if ((col.kind === "json" || col.kind === "text") && CHOICE_AMBIGUOUS_NAME_HINTS.includes(lower)) {
    throw new Error(
      `Column "${col.name}" looks like a choice field. Use kind="single_choice" with choices=[...] or kind="multi_choice" with choices=[...].`,
    )
  }

  if (col.kind === "integer") {
    const looksBool =
      BOOLEAN_NAME_EXACT.includes(lower)
      || BOOLEAN_NAME_PREFIXES.some((p) => lower.startsWith(p))
      || BOOLEAN_NAME_PREFIXES_CN.some((p) => col.name.startsWith(p))
    if (looksBool) {
      throw new Error(
        `Column "${col.name}" is a boolean field. Use kind="boolean".`,
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

function formatSqlDefault(v: SQLInputValue): string {
  if (v === null) return "NULL"
  if (typeof v === "number" || typeof v === "bigint") return String(v)
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`
  throw new Error("Default value for binary columns is not supported")
}

function toBooleanInt(v: unknown): number {
  if (v === true) return 1
  if (v === false) return 0
  throw new Error(`Invalid boolean value: ${JSON.stringify(v)}. Expected true or false`)
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

function validateTimestampString(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = String(v)
  if (!TIMESTAMP_PATTERN.test(s) || Number.isNaN(Date.parse(s))) {
    throw new Error(`Invalid timestamp format: "${s}". Expected ISO 8601`)
  }
  return s
}

class DataStoreService {
  private db: DatabaseSync | null = null
  private dbPath: string = ""
  private columnMeta: Map<string, Map<string, { kind: ColumnKind; choices?: string[] }>> = new Map()

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
      this.backupAndReopenDatabase("corrupt")
    }

    if (this.needsSchemaRebuild()) {
      logger.warn("Legacy data store schema detected. Backing up and creating a fresh database.")
      this.backupAndReopenDatabase("legacy")
    }

    this.ensureSystemSchema()
    this.syncMetaTables()
    this.syncMetaColumns()
    this.refreshColumnMetaCache()

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

  private needsSchemaRebuild(): boolean {
    const db = this.getDb()
    const metaTable = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_meta_columns'`).get()
    if (!metaTable) return false

    const cols = db.prepare(`PRAGMA table_info("_meta_columns")`).all() as { name: string }[]
    const colNames = new Set(cols.map((col) => col.name))
    return !["table_name", "column_name", "kind", "choices", "description"].every((name) => colNames.has(name))
  }

  private backupAndReopenDatabase(reason: "legacy" | "corrupt"): void {
    try { this.db?.close() } catch { /* ignore */ }
    this.db = null

    const timestamp = Date.now()
    const suffix = reason === "legacy" ? `legacy.${timestamp}` : `corrupt.${timestamp}`
    const walPath = `${this.dbPath}-wal`
    const shmPath = `${this.dbPath}-shm`

    try {
      if (existsSync(this.dbPath)) renameSync(this.dbPath, `${this.dbPath}.${suffix}`)
      if (existsSync(walPath)) renameSync(walPath, `${walPath}.${suffix}`)
      if (existsSync(shmPath)) renameSync(shmPath, `${shmPath}.${suffix}`)
    } catch { /* best effort backup */ }

    this.db = new DatabaseSync(this.dbPath)
    this.db.exec("PRAGMA journal_mode=WAL")
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
        kind TEXT NOT NULL,
        choices TEXT,
        description TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (table_name, column_name)
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
        db.prepare(`DELETE FROM "_meta_columns" WHERE table_name = ?`).run(name)
      }
    }
  }

  private syncMetaColumns(): void {
    const db = this.getDb()
    const tables = db.prepare(`SELECT name FROM "_meta_tables"`).all() as { name: string }[]

    for (const { name } of tables) {
      try {
        const columns = db.prepare(`PRAGMA table_info(${q(name)})`).all() as { name: string; type: string }[]
        const userColumns = columns.filter((col) => col.name !== "id" && col.name !== "created_at" && col.name !== "updated_at")
        const actual = new Set(userColumns.map((col) => col.name))
        const tracked = db.prepare(`SELECT column_name FROM "_meta_columns" WHERE table_name = ?`).all(name) as { column_name: string }[]
        for (const row of tracked) {
          if (!actual.has(row.column_name)) {
            db.prepare(`DELETE FROM "_meta_columns" WHERE table_name = ? AND column_name = ?`).run(name, row.column_name)
          }
        }
        for (const col of columns) {
          if (col.name === "id" || col.name === "created_at" || col.name === "updated_at") continue
          db.prepare(`
            INSERT OR IGNORE INTO "_meta_columns" (table_name, column_name, kind, choices, description)
            VALUES (?, ?, ?, NULL, '')
          `).run(name, col.name, affinityToKind(col.type))
        }
      } catch { /* table might not exist */ }
    }
  }

  private refreshColumnMetaCache(): void {
    this.columnMeta.clear()
    const db = this.getDb()
    const metaRows = db.prepare(`SELECT table_name, column_name, kind, choices FROM "_meta_columns"`).all() as {
      table_name: string
      column_name: string
      kind: string
      choices: string | null
    }[]

    for (const row of metaRows) {
      if (!isColumnKind(row.kind)) continue
      let choices: string[] | undefined
      if (row.choices) {
        try {
          const parsed = JSON.parse(row.choices) as unknown
          if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
            choices = parsed
          }
        } catch { /* invalid JSON, skip */ }
      }

      let tableMeta = this.columnMeta.get(row.table_name)
      if (!tableMeta) {
        tableMeta = new Map()
        this.columnMeta.set(row.table_name, tableMeta)
      }
      tableMeta.set(row.column_name, choices && isChoiceKind(row.kind) ? { kind: row.kind, choices } : { kind: row.kind })
    }
  }

  private getColumnMetaForTable(table: string): Map<string, { kind: ColumnKind; choices?: string[] }> {
    return this.columnMeta.get(table) ?? new Map()
  }

  private getColumnsForTable(table: string, predicate: (kind: ColumnKind) => boolean): Set<string> {
    const result = new Set<string>()
    for (const [name, meta] of this.getColumnMetaForTable(table)) {
      if (predicate(meta.kind)) result.add(name)
    }
    return result
  }

  private getJsonColumnsForTable(table: string): Set<string> {
    return this.getColumnsForTable(table, isJsonSerializedKind)
  }

  private getBooleanColumnsForTable(table: string): Set<string> {
    return this.getColumnsForTable(table, isBooleanKind)
  }

  private getDateColumnsForTable(table: string): Set<string> {
    return this.getColumnsForTable(table, isDateKind)
  }

  private getTimestampColumnsForTable(table: string): Set<string> {
    return this.getColumnsForTable(table, isTimestampKind)
  }

  private getChoiceColumnsForTable(table: string): Map<string, string[]> {
    const result = new Map<string, string[]>()
    for (const [name, meta] of this.getColumnMetaForTable(table)) {
      if (isChoiceKind(meta.kind) && meta.choices) result.set(name, meta.choices)
    }
    return result
  }

  private getMultiChoiceColumnsForTable(table: string): Set<string> {
    return this.getColumnsForTable(table, isMultiChoiceKind)
  }

  private validateSingleChoiceValue(key: string, value: unknown, choiceCols: Map<string, string[]>): void {
    const allowed = choiceCols.get(key)
    if (!allowed) return
    if (value === null || value === undefined || value === "") return
    const s = String(value)
    if (!allowed.includes(s)) {
      throw new Error(`Invalid value "${s}" for single_choice column "${key}". Allowed: ${allowed.join(", ")}`)
    }
  }

  private validateMultiChoiceValue(key: string, value: unknown, choiceCols: Map<string, string[]>): void {
    const allowed = choiceCols.get(key)
    if (!allowed) return
    if (value === null || value === undefined) return
    if (!Array.isArray(value)) {
      throw new Error(`multi_choice column "${key}" requires an array value`)
    }
    for (const item of value) {
      const s = String(item)
      if (!allowed.includes(s)) {
        throw new Error(`Invalid value "${s}" for multi_choice column "${key}". Allowed: ${allowed.join(", ")}`)
      }
    }
  }

  private convertWriteValue(
    key: string,
    value: unknown,
    jsonCols: Set<string>,
    boolCols: Set<string>,
    dateCols: Set<string>,
    timestampCols: Set<string>,
    multiChoiceCols?: Set<string>,
  ): SQLInputValue {
    if (value === null || value === undefined) return null
    if (multiChoiceCols?.has(key)) return toSqlValue(JSON.stringify(value))
    if (jsonCols.has(key)) return toSqlValue(JSON.stringify(value))
    if (boolCols.has(key)) return toBooleanInt(value)
    if (dateCols.has(key) && value !== null && value !== undefined && value !== "") {
      return validateDateString(value)
    }
    if (timestampCols.has(key) && value !== null && value !== undefined && value !== "") {
      return validateTimestampString(value)
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

  createTable(name: string, columns: Column[], description?: string): void {
    validateName(name, "table")
    if (columns.length === 0) {
      throw new Error("At least one column is required")
    }

    const seenColumns = new Set<string>()
    for (const col of columns) {
      validateColumnName(col.name)
      validateColumnKind(col.kind)
      validateChoicesConsistency(col)
      const lower = col.name.toLowerCase()
      if (seenColumns.has(lower)) {
        throw new Error(`Duplicate column name "${col.name}"`)
      }
      seenColumns.add(lower)
      assertSemanticallyCorrectColumn(col)
    }

    const db = this.getDb()
    const now = new Date().toISOString()

    const columnDefs = columns.map((col) => `${q(col.name)} ${kindToAffinity(col.kind)}`).join(", ")
    const createSQL = `CREATE TABLE ${q(name)} ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "created_at" TEXT NOT NULL DEFAULT '', "updated_at" TEXT NOT NULL DEFAULT '', ${columnDefs})`

    db.exec("BEGIN")
    try {
      db.exec(createSQL)
      db.prepare(`INSERT INTO "_meta_tables" (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run(name, description ?? "", now, now)
      for (const col of columns) {
        db.prepare(`INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, kind, choices, description) VALUES (?, ?, ?, ?, ?)`)
          .run(name, col.name, col.kind, col.choices ? JSON.stringify(col.choices) : null, col.description ?? "")
      }
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    this.refreshColumnMetaCache()
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

    this.columnMeta.delete(name)
  }

  describeTable(name: string): DataStoreTableSchema {
    this.assertTableExists(name)

    const db = this.getDb()
    const pragmaRows = db.prepare(`PRAGMA table_info(${q(name)})`).all() as {
      name: string
      type: string
      pk: number
    }[]

    const colMetaRows = db.prepare(`SELECT column_name, kind, choices, description FROM "_meta_columns" WHERE table_name = ?`).all(name) as {
      column_name: string
      kind: string
      choices: string | null
      description: string
    }[]
    const colMetaMap = new Map<string, { kind: ColumnKind; choices?: string[]; description: string }>()
    for (const r of colMetaRows) {
      if (!isColumnKind(r.kind)) continue
      let choices: string[] | undefined
      if (r.choices) {
        try {
          const parsed = JSON.parse(r.choices) as unknown
          if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
            choices = parsed
          }
        } catch { /* skip */ }
      }
      colMetaMap.set(r.column_name, choices ? { kind: r.kind, choices, description: r.description } : { kind: r.kind, description: r.description })
    }

    const SYSTEM_COLUMNS = new Set(["id", "created_at", "updated_at"])

    const columns: Column[] = pragmaRows.map((r) => {
      if (r.name === "id") {
        return {
          name: r.name,
          kind: "integer",
          primaryKey: true,
          system: true,
          description: "",
        }
      }
      if (r.name === "created_at" || r.name === "updated_at") {
        return {
          name: r.name,
          kind: "timestamp",
          system: true,
          description: "",
        }
      }

      const meta = colMetaMap.get(r.name)
      const info: Column = {
        name: r.name,
        kind: meta?.kind ?? affinityToKind(r.type),
        description: meta?.description ?? "",
      }
      if (r.pk === 1) info.primaryKey = true
      if (SYSTEM_COLUMNS.has(r.name)) info.system = true
      if (meta?.choices && isChoiceKind(info.kind)) info.choices = meta.choices
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

  addColumn(table: string, column: Column & { default?: unknown }): void {
    validateName(table, "table")
    validateColumnName(column.name)
    validateColumnKind(column.kind)
    validateChoicesConsistency(column)
    assertSemanticallyCorrectColumn(column)
    this.assertTableExists(table)

    if (isChoiceKind(column.kind)) {
      const choices = column.choices ?? []
      if (column.default !== undefined && column.default !== null && column.default !== "") {
        if (isMultiChoiceKind(column.kind)) {
          if (!Array.isArray(column.default)) {
            throw new Error(`Default value for multi_choice column "${column.name}" must be an array`)
          }
          for (const v of column.default as unknown[]) {
            if (!choices.includes(String(v))) {
              throw new Error(`Default value "${v}" is not in choices: ${choices.join(", ")}`)
            }
          }
        } else {
          if (!choices.includes(String(column.default))) {
            throw new Error(`Default value "${column.default}" is not in choices: ${choices.join(", ")}`)
          }
        }
      }
    }

    const db = this.getDb()
    let sql = `ALTER TABLE ${q(table)} ADD COLUMN ${q(column.name)} ${kindToAffinity(column.kind)}`
    if (column.default !== undefined) {
      let defaultVal: SQLInputValue
      if (column.default === null) {
        defaultVal = null
      } else if (isMultiChoiceKind(column.kind) || column.kind === "json") {
        defaultVal = toSqlValue(JSON.stringify(column.default))
      } else if (isBooleanKind(column.kind)) {
        defaultVal = toBooleanInt(column.default)
      } else if (isDateKind(column.kind) && column.default !== null && column.default !== "") {
        defaultVal = validateDateString(column.default)
      } else if (isTimestampKind(column.kind) && column.default !== null && column.default !== "") {
        defaultVal = validateTimestampString(column.default)
      } else {
        defaultVal = toSqlValue(column.default)
      }
      sql += ` DEFAULT ${formatSqlDefault(defaultVal)}`
    }

    db.exec("BEGIN")
    try {
      db.exec(sql)
      db.prepare(`UPDATE "_meta_tables" SET updated_at = ? WHERE name = ?`).run(new Date().toISOString(), table)
      db.prepare(`INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, kind, choices, description) VALUES (?, ?, ?, ?, ?)`)
        .run(table, column.name, column.kind, column.choices ? JSON.stringify(column.choices) : null, column.description ?? "")
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    this.refreshColumnMetaCache()
  }

  updateColumnDescription(table: string, column: string, description: string): void {
    validateName(table, "table")
    validateColumnName(column)
    this.assertTableExists(table)

    const db = this.getDb()
    const existing = db.prepare(`SELECT kind, choices FROM "_meta_columns" WHERE table_name = ? AND column_name = ?`).get(table, column) as {
      kind: string
      choices: string | null
    } | undefined
    if (!existing) {
      throw new Error(`Column "${column}" not found in table "${table}"`)
    }
    db.prepare(`INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, kind, choices, description) VALUES (?, ?, ?, ?, ?)`)
      .run(table, column, existing.kind, existing.choices, description)
    this.refreshColumnMetaCache()
  }

  getColumnChoicesUsage(table: string, column: string): Record<string, number> {
    validateName(table, "table")
    validateColumnName(column)
    this.assertTableExists(table)

    const choiceCols = this.getChoiceColumnsForTable(table)
    const allowed = choiceCols.get(column)
    if (!allowed) {
      throw new Error(`Column "${column}" is not a single_choice or multi_choice column`)
    }

    const db = this.getDb()
    const isMultiChoice = this.getMultiChoiceColumnsForTable(table).has(column)
    const usage: Record<string, number> = {}
    for (const v of allowed) usage[v] = 0

    if (isMultiChoice) {
      const rows = db.prepare(`SELECT ${q(column)} AS v FROM ${q(table)} WHERE ${q(column)} IS NOT NULL AND ${q(column)} != ''`).all() as { v: unknown }[]
      for (const row of rows) {
        try {
          const parsed = JSON.parse(String(row.v))
          if (!Array.isArray(parsed)) continue
          const seen = new Set<string>()
          for (const item of parsed) {
            const s = String(item)
            if (seen.has(s)) continue
            seen.add(s)
            usage[s] = (usage[s] ?? 0) + 1
          }
        } catch { /* ignore malformed JSON */ }
      }
    } else {
      const rows = db.prepare(`SELECT ${q(column)} AS v, COUNT(*) AS c FROM ${q(table)} WHERE ${q(column)} IS NOT NULL AND ${q(column)} != '' GROUP BY ${q(column)}`).all() as { v: unknown; c: number | bigint }[]
      for (const row of rows) {
        const s = String(row.v)
        usage[s] = (usage[s] ?? 0) + toNumber(row.c)
      }
    }

    return usage
  }

  updateColumnChoices(table: string, column: string, choices: string[]): void {
    validateName(table, "table")
    validateColumnName(column)
    this.assertTableExists(table)
    if (choices.length === 0) {
      throw new Error("choices list cannot be empty")
    }
    if (choices.some((choice) => typeof choice !== "string" || choice.length === 0)) {
      throw new Error("choices must be non-empty strings")
    }

    const db = this.getDb()
    const meta = this.getColumnMetaForTable(table).get(column)
    if (!meta || !isChoiceKind(meta.kind)) {
      throw new Error(`Column "${column}" is not a single_choice or multi_choice column`)
    }

    const isMultiChoice = isMultiChoiceKind(meta.kind)
    const allowed = new Set(choices)
    const existingRows = db.prepare(`SELECT DISTINCT ${q(column)} AS v FROM ${q(table)} WHERE ${q(column)} IS NOT NULL AND ${q(column)} != ''`).all() as { v: unknown }[]
    const invalid = new Set<string>()
    for (const row of existingRows) {
      if (row.v === null || row.v === undefined) continue
      if (isMultiChoice) {
        try {
          const parsed = JSON.parse(String(row.v))
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              const s = String(item)
              if (!allowed.has(s)) invalid.add(s)
            }
          }
        } catch { /* ignore malformed JSON */ }
      } else {
        const s = String(row.v)
        if (!allowed.has(s)) invalid.add(s)
      }
    }
    if (invalid.size > 0) {
      const sorted = Array.from(invalid).sort()
      throw new Error(`Cannot update choices for column "${column}": existing rows contain values not in the new list: ${sorted.join(", ")}. Update or delete those rows first, or keep those values in the new list.`)
    }

    db.prepare(`INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, kind, choices, description) VALUES (?, ?, ?, ?, COALESCE((SELECT description FROM "_meta_columns" WHERE table_name = ? AND column_name = ?), ''))`)
      .run(table, column, meta.kind, JSON.stringify(choices), table, column)

    const existing = this.columnMeta.get(table) ?? new Map()
    existing.set(column, { kind: meta.kind, choices })
    this.columnMeta.set(table, existing)
  }

  insert(table: string, data: Record<string, unknown>): { id: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(table)
    const boolCols = this.getBooleanColumnsForTable(table)
    const dateCols = this.getDateColumnsForTable(table)
    const timestampCols = this.getTimestampColumnsForTable(table)
    const choiceCols = this.getChoiceColumnsForTable(table)
    const multiChoiceCols = this.getMultiChoiceColumnsForTable(table)
    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "created_at" && k !== "updated_at"))
    const now = new Date().toISOString()
    const withTimestamps: Record<string, unknown> = { created_at: now, updated_at: now, ...filtered }
    const keys = Object.keys(withTimestamps)
    for (const k of keys) {
      if (k !== "created_at" && k !== "updated_at") {
        validateColumnName(k)
        if (multiChoiceCols.has(k)) {
          this.validateMultiChoiceValue(k, withTimestamps[k], choiceCols)
        } else {
          this.validateSingleChoiceValue(k, withTimestamps[k], choiceCols)
        }
      }
    }
    const values = keys.map((k) => k === "created_at" || k === "updated_at" ? withTimestamps[k] as string : this.convertWriteValue(k, withTimestamps[k], jsonCols, boolCols, dateCols, timestampCols, multiChoiceCols))
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
      const timestampCols = this.getTimestampColumnsForTable(table)
      const choiceCols = this.getChoiceColumnsForTable(table)
      const multiChoiceCols = this.getMultiChoiceColumnsForTable(table)
      for (const row of rows) {
        const filtered = Object.fromEntries(Object.entries(row).filter(([k]) => k !== "created_at" && k !== "updated_at"))
        const now = new Date().toISOString()
        const withTimestamps: Record<string, unknown> = { created_at: now, updated_at: now, ...filtered }
        const keys = Object.keys(withTimestamps)
        for (const k of keys) {
          if (k !== "created_at" && k !== "updated_at") {
            validateColumnName(k)
            if (multiChoiceCols.has(k)) {
              this.validateMultiChoiceValue(k, withTimestamps[k], choiceCols)
            } else {
              this.validateSingleChoiceValue(k, withTimestamps[k], choiceCols)
            }
          }
        }
        const values = keys.map((k) => k === "created_at" || k === "updated_at" ? withTimestamps[k] as string : this.convertWriteValue(k, withTimestamps[k], jsonCols, boolCols, dateCols, timestampCols, multiChoiceCols))
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
    const multiChoiceCols = this.getMultiChoiceColumnsForTable(params.table)
    const { whereSQL, whereParams } = this.buildWhere(params.where, jsonCols, boolCols, multiChoiceCols)
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
      for (const col of multiChoiceCols) {
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
    const timestampCols = this.getTimestampColumnsForTable(table)
    const choiceCols = this.getChoiceColumnsForTable(table)
    const multiChoiceCols = this.getMultiChoiceColumnsForTable(table)
    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "created_at" && k !== "updated_at"))
    const withTimestamp: Record<string, unknown> = { ...filtered, updated_at: new Date().toISOString() }
    const keys = Object.keys(withTimestamp)
    if (keys.length === 0) return { affected: 0 }
    for (const k of keys) {
      if (k !== "updated_at") {
        validateColumnName(k)
        if (multiChoiceCols.has(k)) {
          this.validateMultiChoiceValue(k, withTimestamp[k], choiceCols)
        } else {
          this.validateSingleChoiceValue(k, withTimestamp[k], choiceCols)
        }
      }
    }

    const setClauses = keys.map((k) => `${q(k)} = ?`).join(", ")
    const values = keys.map((k) => k === "updated_at" ? withTimestamp[k] as string : this.convertWriteValue(k, withTimestamp[k], jsonCols, boolCols, dateCols, timestampCols, multiChoiceCols))

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
    const timestampCols = this.getTimestampColumnsForTable(table)
    const choiceCols = this.getChoiceColumnsForTable(table)
    const multiChoiceCols = this.getMultiChoiceColumnsForTable(table)

    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "created_at" && k !== "updated_at"))
    const withTimestamp: Record<string, unknown> = { ...filtered, updated_at: new Date().toISOString() }
    const keys = Object.keys(withTimestamp)
    if (keys.length === 0) return { affected: 0, ids: [] }
    for (const k of keys) {
      if (k !== "updated_at") {
        validateColumnName(k)
        if (multiChoiceCols.has(k)) {
          this.validateMultiChoiceValue(k, withTimestamp[k], choiceCols)
        } else {
          this.validateSingleChoiceValue(k, withTimestamp[k], choiceCols)
        }
      }
    }

    const { whereSQL, whereParams } = this.buildWhere(where, jsonCols, boolCols, multiChoiceCols)
    const setClauses = keys.map((k) => `${q(k)} = ?`).join(", ")
    const values = keys.map((k) => k === "updated_at" ? withTimestamp[k] as string : this.convertWriteValue(k, withTimestamp[k], jsonCols, boolCols, dateCols, timestampCols, multiChoiceCols))

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
    const multiChoiceCols = this.getMultiChoiceColumnsForTable(table)
    const { whereSQL, whereParams } = this.buildWhere(where, jsonCols, boolCols, multiChoiceCols)

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
      this.syncMetaColumns()
      this.refreshColumnMetaCache()
    }

    return { changes: toNumber(result.changes), lastInsertRowid: toNumber(result.lastInsertRowid) }
  }

  count(table: string, where?: DataStoreWhereClause): { count: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(table)
    const boolCols = this.getBooleanColumnsForTable(table)
    const multiChoiceCols = this.getMultiChoiceColumnsForTable(table)
    const { whereSQL, whereParams } = this.buildWhere(where, jsonCols, boolCols, multiChoiceCols)
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${q(table)}${whereSQL}`).get(...whereParams) as { count: number | bigint }
    return { count: toNumber(row.count) }
  }

  renameTable(from: string, to: string): void {
    validateName(from, "table")
    validateName(to, "table")
    if (from === to) return
    this.assertTableExists(from)

    const db = this.getDb()
    const existing = db.prepare(`SELECT COUNT(*) as count FROM "_meta_tables" WHERE name = ?`).get(to) as { count: number }
    if (existing.count > 0) {
      throw new Error(`Table "${to}" already exists`)
    }

    const now = new Date().toISOString()
    db.exec("BEGIN")
    try {
      db.exec(`ALTER TABLE ${q(from)} RENAME TO ${q(to)}`)
      db.prepare(`UPDATE "_meta_tables" SET name = ?, updated_at = ? WHERE name = ?`).run(to, now, from)
      db.prepare(`UPDATE "_meta_columns" SET table_name = ? WHERE table_name = ?`).run(to, from)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    const meta = this.columnMeta.get(from)
    if (meta) {
      this.columnMeta.set(to, meta)
      this.columnMeta.delete(from)
    }
  }

  renameColumn(table: string, from: string, to: string): void {
    validateName(table, "table")
    validateColumnName(from)
    validateColumnName(to)
    if (from === to) return
    this.assertTableExists(table)

    const db = this.getDb()
    const columns = db.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[]
    const names = new Set(columns.map((c) => c.name))
    if (!names.has(from)) {
      throw new Error(`Column "${from}" not found in table "${table}"`)
    }
    if (names.has(to)) {
      throw new Error(`Column "${to}" already exists in table "${table}"`)
    }

    const now = new Date().toISOString()
    db.exec("BEGIN")
    try {
      db.exec(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(from)} TO ${q(to)}`)
      db.prepare(`UPDATE "_meta_columns" SET column_name = ? WHERE table_name = ? AND column_name = ?`).run(to, table, from)
      db.prepare(`UPDATE "_meta_tables" SET updated_at = ? WHERE name = ?`).run(now, table)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    this.refreshColumnMetaCache()
  }

  dropColumn(table: string, column: string): void {
    validateName(table, "table")
    validateColumnName(column)
    this.assertTableExists(table)

    const db = this.getDb()
    const columns = db.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[]
    if (!columns.some((c) => c.name === column)) {
      throw new Error(`Column "${column}" not found in table "${table}"`)
    }
    const userColumnCount = columns.filter((c) => c.name !== "id" && c.name !== "created_at" && c.name !== "updated_at").length
    if (userColumnCount <= 1) {
      throw new Error(`Cannot drop the last user column of table "${table}". Drop the table instead if you no longer need it.`)
    }

    const now = new Date().toISOString()
    db.exec("BEGIN")
    try {
      db.exec(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`)
      db.prepare(`DELETE FROM "_meta_columns" WHERE table_name = ? AND column_name = ?`).run(table, column)
      db.prepare(`UPDATE "_meta_tables" SET updated_at = ? WHERE name = ?`).run(now, table)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    this.refreshColumnMetaCache()
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
      const metaColumns = tempDb.prepare(`PRAGMA table_info("_meta_columns")`).all() as { name: string }[]
      const metaColumnNames = new Set(metaColumns.map((c) => c.name))
      for (const required of ["table_name", "column_name", "kind", "choices", "description"]) {
        if (!metaColumnNames.has(required)) {
          throw new Error(`Invalid database: _meta_columns missing column "${required}"`)
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
      this.syncMetaTables()
      this.syncMetaColumns()
      this.refreshColumnMetaCache()
    } catch (error) {
      try {
        copyFileSync(backupPath, this.dbPath)
        this.db = new DatabaseSync(this.dbPath)
        this.db.exec("PRAGMA journal_mode=WAL")
        this.ensureSystemSchema()
        this.syncMetaTables()
        this.syncMetaColumns()
        this.refreshColumnMetaCache()
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

  private buildWhere(where?: DataStoreWhereClause, jsonCols?: Set<string>, boolCols?: Set<string>, multiChoiceCols?: Set<string>): { whereSQL: string; whereParams: SQLInputValue[] } {
    if (!where) return { whereSQL: "", whereParams: [] }

    const conditions: string[] = []
    const params: SQLInputValue[] = []
    const jCols = jsonCols ?? new Set<string>()
    const bCols = boolCols ?? new Set<string>()
    const mCols = multiChoiceCols ?? new Set<string>()

    const appendCondition = (cond: DataStoreWhereCondition) => {
      validateName(cond.field, "column")
      if (!VALID_WHERE_OPS.has(cond.op)) {
        throw new Error(`Invalid where operator "${cond.op}": must be one of =, !=, >, <, >=, <=, LIKE, CONTAINS`)
      }
      if (cond.op === "CONTAINS") {
        if (!mCols.has(cond.field)) {
          throw new Error(`CONTAINS operator is only supported on multi_choice columns. Column "${cond.field}" is not multi_choice.`)
        }
        if (cond.value === null || cond.value === undefined) {
          throw new Error(`CONTAINS operator requires a non-null scalar value for column "${cond.field}".`)
        }
        if (typeof cond.value === "object") {
          throw new Error(`CONTAINS operator requires a scalar value (string, number, or boolean) for column "${cond.field}". Got ${Array.isArray(cond.value) ? "array" : "object"}. Example: { field: "${cond.field}", op: "CONTAINS", value: "<single item>" }`)
        }
        conditions.push(`EXISTS (SELECT 1 FROM json_each(${q(cond.field)}) WHERE value = ?)`)
        params.push(toSqlValue(cond.value))
        return
      }
      conditions.push(`${q(cond.field)} ${cond.op} ?`)
      if (bCols.has(cond.field)) {
        params.push(toBooleanInt(cond.value))
      } else if (mCols.has(cond.field)) {
        params.push(toSqlValue(JSON.stringify(cond.value)))
      } else {
        const val = jCols.has(cond.field) && cond.value != null && typeof cond.value === "object"
          ? JSON.stringify(cond.value)
          : cond.value
        params.push(toSqlValue(val))
      }
    }

    if (Array.isArray(where)) {
      for (const cond of where as DataStoreWhereCondition[]) {
        appendCondition(cond)
      }
    } else if (isWhereGroup(where)) {
      if (where.combinator !== "all" && where.combinator !== "any") {
        throw new Error(`Invalid where combinator "${where.combinator}": must be "all" or "any"`)
      }
      for (const cond of where.conditions) {
        appendCondition(cond)
      }
      if (conditions.length === 0) return { whereSQL: "", whereParams: [] }
      return { whereSQL: ` WHERE ${conditions.join(where.combinator === "all" ? " AND " : " OR ")}`, whereParams: params }
    } else {
      for (const [key, value] of Object.entries(where)) {
        validateName(key, "column")
        conditions.push(`${q(key)} = ?`)
        if (bCols.has(key)) {
          params.push(toBooleanInt(value))
        } else if (mCols.has(key)) {
          params.push(toSqlValue(JSON.stringify(value)))
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
