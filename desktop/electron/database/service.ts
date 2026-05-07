import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { app } from "electron"
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import type {
  Column,
  ColumnKind,
  DatabaseBulkMutationResult,
  DatabaseOperationLogEntry,
  DatabaseOperationSource,
  DatabaseOverview,
  DatabaseQueryParams,
  DatabaseQueryResult,
  DatabaseTableInfo,
  DatabaseTableImportInspection,
  DatabaseTableSchema,
  DatabaseWhereClause,
} from "./types"
import {
  affinityToKind,
  isBooleanKind,
  isChoiceKind,
  isColumnKind,
  isDateKind,
  isMultiChoiceKind,
  isTimestampKind,
  kindToAffinity,
} from "./column-kind"
import {
  type ColumnMetaMap,
  convertWriteValue,
  getBooleanColumns,
  getChoiceColumns,
  getDateColumns,
  getJsonColumns,
  getMultiChoiceColumns,
  getNumericColumns,
  getTimestampColumns,
  parseReadRow,
  toBooleanInt,
  toSqlValue,
  validateDateString,
  validateTimestampString,
} from "./type-coercion"
import { createMainLogger } from "../services/log-store"
import { buildWhere, buildOrderBy } from "./query-builder"
import {
  SYSTEM_COLUMN_NAMES,
  assertSemanticallyCorrectColumn,
  validateChoicesConsistency,
  validateColumnKind,
  validateColumnName,
  validateMultiChoiceValue,
  validateName,
  validateSingleChoiceValue,
} from "./validators"

const logger = createMainLogger("database.service")

const TABLE_EXPORT_FORMAT = "synapse-table-sql"
const TABLE_EXPORT_VERSION = 1
const TABLE_EXPORT_BEGIN_MARKER = "-- synapse-table-export-b64"
const TABLE_EXPORT_END_MARKER = "-- synapse-table-export-end"
const DATABASE_FILE_NAME = "synapse-database.db"
const LEGACY_DATABASE_FILE_NAME = "synapse-data.db"
const LEGACY_BACKUP_PATTERN = /^synapse-data\.db\.legacy\.(\d+)$/
const LEGACY_TYPE_TO_KIND = new Map<string, ColumnKind>([
  ["TEXT", "text"],
  ["INTEGER", "integer"],
  ["REAL", "decimal"],
  ["BLOB", "binary"],
  ["JSON", "json"],
  ["DATE", "date"],
  ["DATETIME", "timestamp"],
  ["BOOLEAN", "boolean"],
  ["ENUM", "single_choice"],
  ["MULTI_ENUM", "multi_choice"],
])

type SerializedExportValue =
  | null
  | string
  | number
  | boolean
  | { __synapseType: "bigint"; value: string }
  | { __synapseType: "blob"; data: string }

type SerializedTableRow = Record<string, SerializedExportValue>

type TableExportPayload = {
  format: typeof TABLE_EXPORT_FORMAT
  version: typeof TABLE_EXPORT_VERSION
  exportedAt: string
  table: {
    name: string
    description: string
    columns: Column[]
    createdAt: string
    updatedAt: string
  }
  rows: SerializedTableRow[]
}

type BulkMutationOptions = { dryRun?: boolean }

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL"
  if (typeof value === "bigint") return String(value)
  if (typeof value === "boolean") return value ? "1" : "0"
  if (typeof value === "string") return sqlString(value)
  if (ArrayBuffer.isView(value)) {
    return `X'${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("hex")}'`
  }
  return sqlString(String(value))
}

function uniqueStrings(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
      continue
    }
    seen.add(value)
    result.push(value)
  }
  return result
}

function parseLegacyChoices(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? uniqueStrings(parsed) : []
  } catch {
    return []
  }
}

function legacyTypeToKind(type: string, choices: readonly string[]): ColumnKind {
  const upper = type.toUpperCase()
  const kind = LEGACY_TYPE_TO_KIND.get(upper) ?? affinityToKind(upper)
  if (choices.length > 0 && kind !== "multi_choice") return "single_choice"
  return kind
}

function serializeExportValue(value: unknown): SerializedExportValue {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return { __synapseType: "bigint", value: String(value) }
  if (ArrayBuffer.isView(value)) {
    return {
      __synapseType: "blob",
      data: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"),
    }
  }
  return String(value)
}

function deserializeExportValue(value: SerializedExportValue): SQLInputValue {
  if (value === null) return null
  if (typeof value === "string" || typeof value === "number") return value
  if (typeof value === "boolean") return value ? 1 : 0
  if (value.__synapseType === "bigint") return BigInt(value.value)
  return Buffer.from(value.data, "base64")
}

function serializeTableRow(row: Record<string, unknown>): SerializedTableRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, serializeExportValue(value)]),
  )
}

function splitBase64(value: string): string[] {
  const chunks: string[] = []
  for (let index = 0; index < value.length; index += 76) {
    chunks.push(value.slice(index, index + 76))
  }
  return chunks
}

function stringifyPayloadForSql(payload: TableExportPayload): string {
  const base64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
  return [
    TABLE_EXPORT_BEGIN_MARKER,
    ...splitBase64(base64).map((chunk) => `-- ${chunk}`),
    TABLE_EXPORT_END_MARKER,
  ].join("\n")
}

function parsePayloadFromSql(contents: string): TableExportPayload {
  const lines = contents.split(/\r?\n/)
  const startIndex = lines.findIndex((line) => line.trim() === TABLE_EXPORT_BEGIN_MARKER)
  if (startIndex < 0) {
    throw new Error("不是 Synapse 数据表导出文件")
  }

  const chunks: string[] = []
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ""
    if (line === TABLE_EXPORT_END_MARKER) {
      const json = Buffer.from(chunks.join(""), "base64").toString("utf8")
      return assertTableExportPayload(JSON.parse(json) as unknown)
    }
    if (!line.startsWith("-- ")) {
      throw new Error("数据表导出文件已损坏")
    }
    chunks.push(line.slice(3).trim())
  }

  throw new Error("数据表导出文件已损坏")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertSerializedExportValue(value: unknown): asserts value is SerializedExportValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return
  }
  if (!isRecord(value)) {
    throw new Error("数据表导出文件包含无效数据")
  }
  if (value.__synapseType === "bigint" && typeof value.value === "string") return
  if (value.__synapseType === "blob" && typeof value.data === "string") return
  throw new Error("数据表导出文件包含无效数据")
}

function assertTableExportPayload(value: unknown): TableExportPayload {
  if (!isRecord(value) || value.format !== TABLE_EXPORT_FORMAT || value.version !== TABLE_EXPORT_VERSION) {
    throw new Error("不支持的数据表导出格式")
  }
  if (typeof value.exportedAt !== "string" || !isRecord(value.table) || !Array.isArray(value.rows)) {
    throw new Error("数据表导出文件已损坏")
  }

  const table = value.table
  if (
    typeof table.name !== "string"
    || typeof table.description !== "string"
    || typeof table.createdAt !== "string"
    || typeof table.updatedAt !== "string"
    || !Array.isArray(table.columns)
  ) {
    throw new Error("数据表导出文件已损坏")
  }

  for (const column of table.columns) {
    if (!isRecord(column) || typeof column.name !== "string") {
      throw new Error("数据表导出文件包含无效列")
    }
    validateColumnKind(column.kind)
    if (column.description !== undefined && typeof column.description !== "string") {
      throw new Error("数据表导出文件包含无效列")
    }
    if (column.choices !== undefined && !Array.isArray(column.choices)) {
      throw new Error("数据表导出文件包含无效列")
    }
    if (Array.isArray(column.choices) && column.choices.some((choice) => typeof choice !== "string")) {
      throw new Error("数据表导出文件包含无效列")
    }
  }

  for (const row of value.rows) {
    if (!isRecord(row)) {
      throw new Error("数据表导出文件包含无效数据")
    }
    for (const cell of Object.values(row)) {
      assertSerializedExportValue(cell)
    }
  }

  return value as TableExportPayload
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

class DatabaseService {
  private db: DatabaseSync | null = null
  private dbPath: string = ""
  private columnMeta: Map<string, ColumnMetaMap> = new Map()

  open(): { corrupted: boolean } {
    const userDataPath = app.getPath("userData")
    this.migrateLegacyDatabaseFileName(userDataPath)
    this.dbPath = path.join(userDataPath, DATABASE_FILE_NAME)
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
      this.backupAndReopenDatabase()
    }

    this.recoverLatestLegacyBackupIfCurrentIsEmpty()

    if (this.needsLegacySchemaMigration()) {
      logger.warn("Legacy database schema detected. Migrating in place.")
      this.createLegacyMigrationBackup()
      this.migrateLegacySchema()
    }

    this.ensureSystemSchema()
    this.syncMetaTables()
    this.syncMetaColumns()
    this.refreshColumnMetaCache()

    logger.info("Database opened.", { path: this.dbPath, corrupted })
    return { corrupted }
  }

  private migrateLegacyDatabaseFileName(userDataPath: string): void {
    const currentPath = path.join(userDataPath, DATABASE_FILE_NAME)
    const legacyPath = path.join(userDataPath, LEGACY_DATABASE_FILE_NAME)
    if (existsSync(currentPath) || !existsSync(legacyPath)) return

    const moved: Array<{ from: string; to: string }> = []
    const move = (from: string, to: string): void => {
      if (!existsSync(from)) return
      renameSync(from, to)
      moved.push({ from, to })
    }

    try {
      move(legacyPath, currentPath)
      move(`${legacyPath}-wal`, `${currentPath}-wal`)
      move(`${legacyPath}-shm`, `${currentPath}-shm`)
      logger.info("Legacy database file name migrated.", {
        from: legacyPath,
        to: currentPath,
      })
    } catch (error) {
      this.restoreMovedFiles(moved)
      throw new Error(`Failed to migrate legacy database file name: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      logger.info("Database closed.")
    }
  }

  private getDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("Database is not open")
    }
    return this.db
  }

  private needsLegacySchemaMigration(): boolean {
    const db = this.getDb()
    const metaTable = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_meta_columns'`).get()
    if (!metaTable) return false

    const cols = db.prepare(`PRAGMA table_info("_meta_columns")`).all() as { name: string }[]
    const colNames = new Set(cols.map((col) => col.name))
    return !["table_name", "column_name", "kind"].every((name) => colNames.has(name))
  }

  private recoverLatestLegacyBackupIfCurrentIsEmpty(): void {
    if (!this.currentDatabaseCanRecoverFromLegacyBackup()) {
      return
    }

    const backup = this.findLatestLegacyBackup()
    if (!backup) {
      return
    }

    logger.warn("Empty database detected. Restoring latest legacy backup.", {
      backupPath: backup.filePath,
    })
    this.restoreLegacyBackup(backup)
  }

  private currentDatabaseCanRecoverFromLegacyBackup(): boolean {
    const db = this.getDb()
    const userTables = this.getUserTableNames(db)
    if (userTables.length > 0) return false

    const operationLog = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_operation_log'`).get()
    if (!operationLog) return true

    const row = db.prepare(`SELECT COUNT(*) AS count FROM "_operation_log"`).get() as { count: number | bigint }
    return toNumber(row.count) === 0
  }

  private findLatestLegacyBackup(): { filePath: string; timestamp: number } | null {
    let entries: string[]
    try {
      entries = readdirSync(path.dirname(this.dbPath))
    } catch (error) {
      logger.warn("Failed to inspect database directory for legacy backups.", { error })
      return null
    }

    const backups = entries
      .map((name) => {
        const match = name.match(LEGACY_BACKUP_PATTERN)
        if (!match) return null
        const filePath = path.join(path.dirname(this.dbPath), name)
        if (!existsSync(filePath)) return null
        return { filePath, timestamp: Number(match[1]) }
      })
      .filter((item): item is { filePath: string; timestamp: number } => item !== null)
      .sort((a, b) => b.timestamp - a.timestamp)

    return backups[0] ?? null
  }

  private restoreLegacyBackup(backup: { filePath: string; timestamp: number }): void {
    const recoverySuffix = `before-legacy-recovery.${Date.now()}`
    const currentWalPath = `${this.dbPath}-wal`
    const currentShmPath = `${this.dbPath}-shm`
    const legacyWalPath = path.join(path.dirname(this.dbPath), `synapse-data.db-wal.legacy.${backup.timestamp}`)
    const legacyShmPath = path.join(path.dirname(this.dbPath), `synapse-data.db-shm.legacy.${backup.timestamp}`)

    try { this.db?.close() } catch (error) {
      logger.warn("Failed to close database before restoring legacy backup.", { error })
    }
    this.db = null

    const moved: Array<{ from: string; to: string }> = []
    try {
      this.moveIfExists(this.dbPath, recoverySuffix, moved)
      this.moveIfExists(currentWalPath, recoverySuffix, moved)
      this.moveIfExists(currentShmPath, recoverySuffix, moved)

      copyFileSync(backup.filePath, this.dbPath)
      if (existsSync(legacyWalPath)) copyFileSync(legacyWalPath, currentWalPath)
      if (existsSync(legacyShmPath)) copyFileSync(legacyShmPath, currentShmPath)

      this.db = new DatabaseSync(this.dbPath)
      this.db.exec("PRAGMA journal_mode=WAL")
    } catch (error) {
      logger.error("Failed to restore legacy database backup.", { error })
      this.restoreMovedFiles(moved)
      this.db = new DatabaseSync(this.dbPath)
      this.db.exec("PRAGMA journal_mode=WAL")
      throw error
    }
  }

  private moveIfExists(filePath: string, suffix: string, moved: Array<{ from: string; to: string }>): void {
    if (!existsSync(filePath)) return
    const nextPath = `${filePath}.${suffix}`
    renameSync(filePath, nextPath)
    moved.push({ from: filePath, to: nextPath })
  }

  private restoreMovedFiles(moved: readonly { from: string; to: string }[]): void {
    for (const entry of [...moved].reverse()) {
      try {
        if (existsSync(entry.from)) unlinkSync(entry.from)
        if (existsSync(entry.to)) renameSync(entry.to, entry.from)
      } catch (error) {
        logger.warn("Failed to restore database file after legacy recovery failure.", {
          error,
          from: entry.to,
          to: entry.from,
        })
      }
    }
  }

  private createLegacyMigrationBackup(): void {
    const suffix = `legacy-migration.${Date.now()}`
    const backupPath = `${this.dbPath}.${suffix}`
    const walPath = `${this.dbPath}-wal`
    const shmPath = `${this.dbPath}-shm`

    try {
      this.getDb().exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } catch (error) {
      logger.warn("Failed to checkpoint database before legacy migration backup.", { error })
    }

    copyFileSync(this.dbPath, backupPath)
    if (existsSync(walPath)) copyFileSync(walPath, `${walPath}.${suffix}`)
    if (existsSync(shmPath)) copyFileSync(shmPath, `${shmPath}.${suffix}`)

    logger.info("Legacy database migration backup created.", { path: backupPath })
  }

  private migrateLegacySchema(): void {
    const db = this.getDb()

    db.exec("BEGIN")
    try {
      this.ensureLegacyMetaColumns()
      for (const table of this.getUserTableNames(db)) {
        this.migrateLegacyTableColumns(table)
      }
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }

  private ensureLegacyMetaColumns(): void {
    const db = this.getDb()
    const columns = db.prepare(`PRAGMA table_info("_meta_columns")`).all() as { name: string }[]
    const names = new Set(columns.map((column) => column.name))

    if (!names.has("description")) {
      db.exec(`ALTER TABLE "_meta_columns" ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
    }
    if (!names.has("enum_values")) {
      db.exec(`ALTER TABLE "_meta_columns" ADD COLUMN enum_values TEXT NOT NULL DEFAULT ''`)
    }
    if (!names.has("kind")) {
      db.exec(`ALTER TABLE "_meta_columns" ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'`)
    }
    if (!names.has("choices")) {
      db.exec(`ALTER TABLE "_meta_columns" ADD COLUMN choices TEXT`)
    }
  }

  private migrateLegacyTableColumns(table: string): void {
    const db = this.getDb()
    const metaRows = db.prepare(`
      SELECT column_name, description, enum_values
      FROM "_meta_columns"
      WHERE table_name = ?
    `).all(table) as Array<{ column_name: string; description: string; enum_values: string }>

    const legacyMeta = new Map(metaRows.map((row) => [row.column_name, row]))
    const columns = db.prepare(`PRAGMA table_info(${q(table)})`).all() as Array<{ name: string; type: string }>

    for (const column of columns) {
      if (SYSTEM_COLUMN_NAMES.has(column.name)) {
        continue
      }

      const meta = legacyMeta.get(column.name)
      const parsedChoices = parseLegacyChoices(meta?.enum_values ?? "")
      let kind = legacyTypeToKind(column.type, parsedChoices)
      let choices = parsedChoices

      if (isChoiceKind(kind) && choices.length === 0) {
        choices = this.inferLegacyChoices(table, column.name, kind)
        if (choices.length === 0) {
          kind = "text"
        }
      }

      db.prepare(`
        INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, kind, choices, description)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        table,
        column.name,
        kind,
        isChoiceKind(kind) ? JSON.stringify(choices) : null,
        meta?.description ?? "",
      )
    }
  }

  private inferLegacyChoices(table: string, column: string, kind: ColumnKind): string[] {
    const db = this.getDb()
    if (kind === "single_choice") {
      const rows = db.prepare(`
        SELECT DISTINCT ${q(column)} AS value
        FROM ${q(table)}
        WHERE ${q(column)} IS NOT NULL AND ${q(column)} != ''
        ORDER BY ${q(column)}
      `).all() as { value: unknown }[]
      return uniqueStrings(rows.map((row) => String(row.value)))
    }

    if (kind !== "multi_choice") return []

    const rows = db.prepare(`
      SELECT ${q(column)} AS value
      FROM ${q(table)}
      WHERE ${q(column)} IS NOT NULL AND ${q(column)} != ''
    `).all() as { value: unknown }[]
    const choices: string[] = []

    for (const row of rows) {
      try {
        const parsed = JSON.parse(String(row.value)) as unknown
        if (Array.isArray(parsed)) choices.push(...uniqueStrings(parsed))
      } catch (error) {
        logger.warn("Failed to infer legacy multi-choice values.", {
          error,
          table,
          column,
        })
      }
    }

    return uniqueStrings(choices).sort((a, b) => a.localeCompare(b))
  }

  private getUserTableNames(db: DatabaseSync): string[] {
    return (db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type='table'
        AND name NOT LIKE '\\_%' ESCAPE '\\'
        AND name != 'sqlite_sequence'
      ORDER BY name
    `).all() as { name: string }[]).map((row) => row.name)
  }

  private backupAndReopenDatabase(): void {
    try { this.db?.close() } catch { /* ignore */ }
    this.db = null

    const timestamp = Date.now()
    const suffix = `corrupt.${timestamp}`
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
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_operation_log" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "source" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "table_name" TEXT,
        "affected" INTEGER,
        "dry_run" INTEGER NOT NULL DEFAULT 0,
        "created_at" TEXT NOT NULL
      )
    `)
    this.ensureSystemMetaColumnShape()
  }

  private ensureSystemMetaColumnShape(): void {
    const db = this.getDb()
    const columns = db.prepare(`PRAGMA table_info("_meta_columns")`).all() as { name: string }[]
    const names = new Set(columns.map((column) => column.name))

    if (!names.has("choices")) {
      db.exec(`ALTER TABLE "_meta_columns" ADD COLUMN choices TEXT`)
    }
    if (!names.has("description")) {
      db.exec(`ALTER TABLE "_meta_columns" ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
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

  private getColumnMetaForTable(table: string): ColumnMetaMap {
    return this.columnMeta.get(table) ?? new Map()
  }

  private getJsonColumnsForTable(table: string): Set<string> {
    return getJsonColumns(this.getColumnMetaForTable(table))
  }

  private getBooleanColumnsForTable(table: string): Set<string> {
    return getBooleanColumns(this.getColumnMetaForTable(table))
  }

  private getDateColumnsForTable(table: string): Set<string> {
    return getDateColumns(this.getColumnMetaForTable(table))
  }

  private getTimestampColumnsForTable(table: string): Set<string> {
    return getTimestampColumns(this.getColumnMetaForTable(table))
  }

  private getChoiceColumnsForTable(table: string): Map<string, string[]> {
    return getChoiceColumns(this.getColumnMetaForTable(table))
  }

  private getMultiChoiceColumnsForTable(table: string): Set<string> {
    return getMultiChoiceColumns(this.getColumnMetaForTable(table))
  }

  private getNumericColumnsForTable(table: string): Map<string, "integer" | "decimal"> {
    return getNumericColumns(this.getColumnMetaForTable(table))
  }

  private assertTableExists(name: string): void {
    const db = this.getDb()
    const row = db.prepare(`SELECT COUNT(*) as count FROM "_meta_tables" WHERE name = ?`).get(name) as { count: number }
    if (row.count === 0) {
      throw new Error(`Table "${name}" not found`)
    }
  }

  databaseTableList(): DatabaseTableInfo[] {
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

  databaseOverviewGet(): DatabaseOverview {
    const tables = this.databaseTableList().map((table) => {
      const schema = this.databaseTableDescribe(table.name)
      return {
        name: schema.name,
        description: schema.description,
        rowCount: schema.rowCount,
        columns: schema.columns.map((column) => ({
          name: column.name,
          kind: column.kind,
          description: column.description ?? "",
          ...(column.choices ? { choices: column.choices } : {}),
          ...(column.system ? { system: true as const } : {}),
        })),
      }
    })

    return { tableCount: tables.length, tables }
  }

  databaseTableCreate(name: string, columns: Column[], description?: string): void {
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

  databaseTableDelete(name: string): void {
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

  databaseTableDescribe(name: string): DatabaseTableSchema {
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

  databaseTableUpdate(table: string, description: string): void {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    db.prepare(`UPDATE "_meta_tables" SET description = ?, updated_at = ? WHERE name = ?`)
      .run(description, new Date().toISOString(), table)
  }

  databaseColumnCreate(table: string, column: Column & { default?: unknown }): void {
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

  databaseColumnUpdate(table: string, column: string, description: string): void {
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

  databaseChoiceUsageGet(table: string, column: string): Record<string, number> {
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

  databaseChoiceUpdate(table: string, column: string, choices: string[]): void {
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

  databaseRowCreate(table: string, data: Record<string, unknown>): { id: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(table)
    const boolCols = this.getBooleanColumnsForTable(table)
    const dateCols = this.getDateColumnsForTable(table)
    const timestampCols = this.getTimestampColumnsForTable(table)
    const choiceCols = this.getChoiceColumnsForTable(table)
    const multiChoiceCols = this.getMultiChoiceColumnsForTable(table)
    const numericCols = this.getNumericColumnsForTable(table)
    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "created_at" && k !== "updated_at"))
    const now = new Date().toISOString()
    const withTimestamps: Record<string, unknown> = { created_at: now, updated_at: now, ...filtered }
    const keys = Object.keys(withTimestamps)
    for (const k of keys) {
      if (k !== "created_at" && k !== "updated_at") {
        validateColumnName(k)
        if (multiChoiceCols.has(k)) {
          validateMultiChoiceValue(k, withTimestamps[k], choiceCols)
        } else {
          validateSingleChoiceValue(k, withTimestamps[k], choiceCols)
        }
      }
    }
    const values = keys.map((k) => k === "created_at" || k === "updated_at" ? withTimestamps[k] as string : convertWriteValue(k, withTimestamps[k], jsonCols, boolCols, dateCols, timestampCols, multiChoiceCols, numericCols))
    const placeholders = keys.map(() => "?").join(", ")
    const columnList = keys.map(q).join(", ")

    const result = db.prepare(`INSERT INTO ${q(table)} (${columnList}) VALUES (${placeholders})`).run(...values)
    return { id: toNumber(result.lastInsertRowid) }
  }

  databaseRowsCreate(table: string, rows: Record<string, unknown>[]): { ids: number[] } {
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
      const numericCols = this.getNumericColumnsForTable(table)
      for (const row of rows) {
        const filtered = Object.fromEntries(Object.entries(row).filter(([k]) => k !== "created_at" && k !== "updated_at"))
        const now = new Date().toISOString()
        const withTimestamps: Record<string, unknown> = { created_at: now, updated_at: now, ...filtered }
        const keys = Object.keys(withTimestamps)
        for (const k of keys) {
          if (k !== "created_at" && k !== "updated_at") {
            validateColumnName(k)
            if (multiChoiceCols.has(k)) {
              validateMultiChoiceValue(k, withTimestamps[k], choiceCols)
            } else {
              validateSingleChoiceValue(k, withTimestamps[k], choiceCols)
            }
          }
        }
        const values = keys.map((k) => k === "created_at" || k === "updated_at" ? withTimestamps[k] as string : convertWriteValue(k, withTimestamps[k], jsonCols, boolCols, dateCols, timestampCols, multiChoiceCols, numericCols))
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

  databaseRowList(params: DatabaseQueryParams): DatabaseQueryResult {
    validateName(params.table, "table")
    this.assertTableExists(params.table)

    const db = this.getDb()
    const tableMeta = this.getColumnMetaForTable(params.table)
    const jsonCols = getJsonColumns(tableMeta)
    const boolCols = getBooleanColumns(tableMeta)
    const multiChoiceCols = getMultiChoiceColumns(tableMeta)
    const { whereSQL, whereParams } = buildWhere(params.where, tableMeta)
    const orderSQL = buildOrderBy(params.orderBy)
    const limit = params.limit ?? 100
    const offset = params.offset ?? 0

    const dataSQL = `SELECT * FROM ${q(params.table)}${whereSQL}${orderSQL} LIMIT ? OFFSET ?`
    const rows = db.prepare(dataSQL).all(...whereParams, limit, offset) as Record<string, unknown>[]

    const countSQL = `SELECT COUNT(*) as total FROM ${q(params.table)}${whereSQL}`
    const countRow = db.prepare(countSQL).get(...whereParams) as { total: number }

    for (const row of rows) {
      parseReadRow(row, jsonCols, boolCols, multiChoiceCols)
    }

    return { rows, total: countRow.total }
  }

  databaseRowUpdate(table: string, id: number, data: Record<string, unknown>): { affected: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const jsonCols = this.getJsonColumnsForTable(table)
    const boolCols = this.getBooleanColumnsForTable(table)
    const dateCols = this.getDateColumnsForTable(table)
    const timestampCols = this.getTimestampColumnsForTable(table)
    const choiceCols = this.getChoiceColumnsForTable(table)
    const multiChoiceCols = this.getMultiChoiceColumnsForTable(table)
    const numericCols = this.getNumericColumnsForTable(table)
    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "created_at" && k !== "updated_at"))
    const withTimestamp: Record<string, unknown> = { ...filtered, updated_at: new Date().toISOString() }
    const keys = Object.keys(withTimestamp)
    if (keys.length === 0) return { affected: 0 }
    for (const k of keys) {
      if (k !== "updated_at") {
        validateColumnName(k)
        if (multiChoiceCols.has(k)) {
          validateMultiChoiceValue(k, withTimestamp[k], choiceCols)
        } else {
          validateSingleChoiceValue(k, withTimestamp[k], choiceCols)
        }
      }
    }

    const setClauses = keys.map((k) => `${q(k)} = ?`).join(", ")
    const values = keys.map((k) => k === "updated_at" ? withTimestamp[k] as string : convertWriteValue(k, withTimestamp[k], jsonCols, boolCols, dateCols, timestampCols, multiChoiceCols, numericCols))

    const result = db.prepare(`UPDATE ${q(table)} SET ${setClauses} WHERE "id" = ?`).run(...values, id)
    return { affected: toNumber(result.changes) }
  }

  databaseRowDelete(table: string, id: number): { affected: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const result = db.prepare(`DELETE FROM ${q(table)} WHERE "id" = ?`).run(id)
    return { affected: toNumber(result.changes) }
  }

  databaseRowsUpdate(table: string, where: DatabaseWhereClause, data: Record<string, unknown>, options: BulkMutationOptions = {}): DatabaseBulkMutationResult {
    validateName(table, "table")
    this.assertTableExists(table)

    const whereEmpty = !where
      || (Array.isArray(where) ? where.length === 0 : Object.keys(where).length === 0)
    if (whereEmpty) {
      throw new Error("database.rows.update requires a non-empty where clause. Use database.row.update to target a single row by id.")
    }

    const db = this.getDb()
    const tableMeta = this.getColumnMetaForTable(table)
    const jsonCols = getJsonColumns(tableMeta)
    const boolCols = getBooleanColumns(tableMeta)
    const dateCols = getDateColumns(tableMeta)
    const timestampCols = getTimestampColumns(tableMeta)
    const choiceCols = getChoiceColumns(tableMeta)
    const multiChoiceCols = getMultiChoiceColumns(tableMeta)
    const numericCols = getNumericColumns(tableMeta)

    const filtered = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "created_at" && k !== "updated_at"))
    const withTimestamp: Record<string, unknown> = { ...filtered, updated_at: new Date().toISOString() }
    const keys = Object.keys(withTimestamp)
    if (keys.length === 0) return { affected: 0, ids: [] }
    for (const k of keys) {
      if (k !== "updated_at") {
        validateColumnName(k)
        if (multiChoiceCols.has(k)) {
          validateMultiChoiceValue(k, withTimestamp[k], choiceCols)
        } else {
          validateSingleChoiceValue(k, withTimestamp[k], choiceCols)
        }
      }
    }

    const { whereSQL, whereParams } = buildWhere(where, tableMeta)
    const setClauses = keys.map((k) => `${q(k)} = ?`).join(", ")
    const values = keys.map((k) => k === "updated_at" ? withTimestamp[k] as string : convertWriteValue(k, withTimestamp[k], jsonCols, boolCols, dateCols, timestampCols, multiChoiceCols, numericCols))

    db.exec("BEGIN")
    try {
      const idRows = db.prepare(`SELECT "id" FROM ${q(table)}${whereSQL}`).all(...whereParams) as { id: number | bigint }[]
      const ids = idRows.map((r) => toNumber(r.id))
      if (ids.length === 0) {
        db.exec("COMMIT")
        return { affected: 0, ids: [] }
      }
      if (options.dryRun) {
        db.exec("COMMIT")
        return { affected: ids.length, ids, dryRun: true }
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

  databaseRowsDelete(table: string, where: DatabaseWhereClause, options: BulkMutationOptions = {}): DatabaseBulkMutationResult {
    validateName(table, "table")
    this.assertTableExists(table)

    const whereEmpty = !where
      || (Array.isArray(where) ? where.length === 0 : Object.keys(where).length === 0)
    if (whereEmpty) {
      throw new Error("database.rows.delete requires a non-empty where clause. Use database.row.delete to target a single row by id, or drop and recreate the table to clear it.")
    }

    const db = this.getDb()
    const tableMeta = this.getColumnMetaForTable(table)
    const { whereSQL, whereParams } = buildWhere(where, tableMeta)

    db.exec("BEGIN")
    try {
      const idRows = db.prepare(`SELECT "id" FROM ${q(table)}${whereSQL}`).all(...whereParams) as { id: number | bigint }[]
      const ids = idRows.map((r) => toNumber(r.id))
      if (ids.length === 0) {
        db.exec("COMMIT")
        return { affected: 0, ids: [] }
      }
      if (options.dryRun) {
        db.exec("COMMIT")
        return { affected: ids.length, ids, dryRun: true }
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

  databaseSqlExecute(sql: string, params?: unknown[]): { rows?: Record<string, unknown>[]; changes?: number; lastInsertRowid?: number } {
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

  databaseSqlRead(sql: string, params?: unknown[]): { rows: Record<string, unknown>[] } {
    const normalized = sql.trim().toLowerCase()
    if (!/^(select|pragma|explain)\b/.test(normalized)) {
      throw new Error("database.sql.read is read-only. Use database.sql.execute when you explicitly need to write.")
    }
    if (/\b(attach|detach)\b/i.test(normalized)) {
      throw new Error("ATTACH and DETACH statements are not allowed")
    }

    const db = this.getDb()
    const sqlParams = (params ?? []).map(toSqlValue)
    const rows = db.prepare(sql).all(...sqlParams) as Record<string, unknown>[]
    return { rows }
  }

  recordOperation(entry: {
    source: DatabaseOperationSource
    action: string
    table?: string
    affected?: number
    dryRun?: boolean
  }): void {
    const db = this.getDb()
    db.prepare(`
      INSERT INTO "_operation_log" ("source", "action", "table_name", "affected", "dry_run", "created_at")
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.source,
      entry.action,
      entry.table ?? null,
      entry.affected ?? null,
      entry.dryRun ? 1 : 0,
      new Date().toISOString(),
    )
  }

  databaseLogList(limit = 50): DatabaseOperationLogEntry[] {
    const db = this.getDb()
    const rows = db.prepare(`
      SELECT "id", "source", "action", "table_name", "affected", "dry_run", "created_at"
      FROM "_operation_log"
      ORDER BY "id" DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: number | bigint
      source: DatabaseOperationSource
      action: string
      table_name: string | null
      affected: number | bigint | null
      dry_run: number
      created_at: string
    }>

    return rows.map((row) => ({
      id: toNumber(row.id),
      source: row.source,
      action: row.action,
      table: row.table_name,
      affected: row.affected === null ? null : toNumber(row.affected),
      dryRun: row.dry_run === 1,
      createdAt: row.created_at,
    }))
  }

  databaseRowCount(table: string, where?: DatabaseWhereClause): { count: number } {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const tableMeta = this.getColumnMetaForTable(table)
    const { whereSQL, whereParams } = buildWhere(where, tableMeta)
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${q(table)}${whereSQL}`).get(...whereParams) as { count: number | bigint }
    return { count: toNumber(row.count) }
  }

  databaseTableRename(from: string, to: string): void {
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

  databaseColumnRename(table: string, from: string, to: string): void {
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

  databaseColumnDelete(table: string, column: string): void {
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

  getDiagnosticsHealth(): {
    quickCheck: string
    metaTableCount: number
    metaColumnCount: number
    operationLogCount: number
  } {
    const db = this.getDb()
    const quickCheckRows = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[]
    const quickCheck = quickCheckRows.map((row) => row.quick_check).join("\n") || "unknown"
    const metaTableCount = db.prepare(`SELECT COUNT(*) as count FROM "_meta_tables"`).get() as { count: number }
    const metaColumnCount = db.prepare(`SELECT COUNT(*) as count FROM "_meta_columns"`).get() as { count: number }
    const operationLogCount = db.prepare(`SELECT COUNT(*) as count FROM "_operation_log"`).get() as { count: number }

    return {
      quickCheck,
      metaTableCount: metaTableCount.count,
      metaColumnCount: metaColumnCount.count,
      operationLogCount: operationLogCount.count,
    }
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
      const hasCurrentMetaColumns = ["table_name", "column_name", "kind", "choices", "description"]
        .every((required) => metaColumnNames.has(required))
      const hasLegacyMetaColumns = ["table_name", "column_name", "enum_values"]
        .every((required) => metaColumnNames.has(required))
      if (!hasCurrentMetaColumns && !hasLegacyMetaColumns) {
        const required = "table_name, column_name, kind/choices or enum_values"
        throw new Error(`Invalid database: _meta_columns missing required columns (${required})`)
      }
      for (const required of ["table_name", "column_name"]) {
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
      if (this.needsLegacySchemaMigration()) {
        logger.warn("Imported legacy database schema detected. Migrating in place.")
        this.migrateLegacySchema()
      }
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

  exportTable(table: string, targetPath: string): void {
    validateName(table, "table")
    this.assertTableExists(table)

    const db = this.getDb()
    const schema = this.databaseTableDescribe(table)
    const userColumns = schema.columns.filter((column) => !column.system && !column.primaryKey)
    const rows = db.prepare(`SELECT * FROM ${q(table)} ORDER BY "id" ASC`).all() as Record<string, unknown>[]
    const payload: TableExportPayload = {
      format: TABLE_EXPORT_FORMAT,
      version: TABLE_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      table: {
        name: schema.name,
        description: schema.description,
        columns: userColumns,
        createdAt: schema.createdAt,
        updatedAt: schema.updatedAt,
      },
      rows: rows.map(serializeTableRow),
    }

    const columnNames = schema.columns.map((column) => column.name)
    const sql = [
      "-- Synapse Table Export",
      `-- table: ${table}`,
      `-- exported_at: ${payload.exportedAt}`,
      stringifyPayloadForSql(payload),
      "",
      "BEGIN;",
      this.buildExportSystemSchemaSql(),
      `DROP TABLE IF EXISTS ${q(table)};`,
      `DELETE FROM "_meta_tables" WHERE name = ${sqlLiteral(table)};`,
      `DELETE FROM "_meta_columns" WHERE table_name = ${sqlLiteral(table)};`,
      this.buildExportCreateTableSql(table, userColumns),
      this.buildExportMetaTableSql(payload),
      ...userColumns.map((column) => this.buildExportMetaColumnSql(table, column)),
      ...rows.map((row) => this.buildExportInsertSql(table, columnNames, row)),
      "COMMIT;",
      "",
    ].join("\n")

    writeFileSync(targetPath, sql, "utf8")
    logger.info("Table exported.", { table, targetPath })
  }

  inspectTableImport(sourcePath: string): DatabaseTableImportInspection {
    const payload = this.readTableExportPayload(sourcePath)
    const tableName = payload.table.name
    return {
      tableName,
      exists: this.tableExists(tableName),
      sourcePath,
    }
  }

  importTable(sourcePath: string): string {
    const payload = this.readTableExportPayload(sourcePath)
    this.replaceTableFromExport(payload)
    logger.info("Table imported.", { table: payload.table.name, sourcePath })
    return payload.table.name
  }

  private readTableExportPayload(sourcePath: string): TableExportPayload {
    return parsePayloadFromSql(readFileSync(sourcePath, "utf8"))
  }

  private tableExists(name: string): boolean {
    validateName(name, "table")
    const db = this.getDb()
    const row = db.prepare(`SELECT COUNT(*) as count FROM "_meta_tables" WHERE name = ?`).get(name) as { count: number }
    return row.count > 0
  }

  private buildExportCreateTableSql(table: string, columns: Column[]): string {
    const columnDefs = columns.map((column) => `${q(column.name)} ${kindToAffinity(column.kind)}`).join(", ")
    return `CREATE TABLE ${q(table)} ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "created_at" TEXT NOT NULL DEFAULT '', "updated_at" TEXT NOT NULL DEFAULT ''${columnDefs ? `, ${columnDefs}` : ""});`
  }

  private buildExportSystemSchemaSql(): string {
    return [
      `CREATE TABLE IF NOT EXISTS "_meta_tables" (name TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
      `CREATE TABLE IF NOT EXISTS "_meta_columns" (table_name TEXT NOT NULL, column_name TEXT NOT NULL, kind TEXT NOT NULL, choices TEXT, description TEXT NOT NULL DEFAULT '', PRIMARY KEY (table_name, column_name));`,
    ].join("\n")
  }

  private buildExportMetaTableSql(payload: TableExportPayload): string {
    return `INSERT OR REPLACE INTO "_meta_tables" (name, description, created_at, updated_at) VALUES (${[
      payload.table.name,
      payload.table.description,
      payload.table.createdAt,
      payload.table.updatedAt,
    ].map(sqlLiteral).join(", ")});`
  }

  private buildExportMetaColumnSql(table: string, column: Column): string {
    return `INSERT OR REPLACE INTO "_meta_columns" (table_name, column_name, kind, choices, description) VALUES (${[
      table,
      column.name,
      column.kind,
      column.choices ? JSON.stringify(column.choices) : null,
      column.description ?? "",
    ].map(sqlLiteral).join(", ")});`
  }

  private buildExportInsertSql(table: string, columnNames: string[], row: Record<string, unknown>): string {
    const columnsSql = columnNames.map(q).join(", ")
    const valuesSql = columnNames.map((columnName) => sqlLiteral(row[columnName])).join(", ")
    return `INSERT INTO ${q(table)} (${columnsSql}) VALUES (${valuesSql});`
  }

  private replaceTableFromExport(payload: TableExportPayload): void {
    const table = payload.table.name
    validateName(table, "table")
    this.validateImportedColumns(payload.table.columns)

    const db = this.getDb()
    const allColumnNames = ["id", "created_at", "updated_at", ...payload.table.columns.map((column) => column.name)]
    const placeholders = allColumnNames.map(() => "?").join(", ")
    const insertSql = `INSERT INTO ${q(table)} (${allColumnNames.map(q).join(", ")}) VALUES (${placeholders})`

    db.exec("BEGIN")
    try {
      db.exec(`DROP TABLE IF EXISTS ${q(table)}`)
      db.prepare(`DELETE FROM "_meta_tables" WHERE name = ?`).run(table)
      db.prepare(`DELETE FROM "_meta_columns" WHERE table_name = ?`).run(table)
      db.exec(this.buildExportCreateTableSql(table, payload.table.columns))
      db.prepare(`INSERT INTO "_meta_tables" (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run(payload.table.name, payload.table.description, payload.table.createdAt, payload.table.updatedAt)
      for (const column of payload.table.columns) {
        db.prepare(`INSERT INTO "_meta_columns" (table_name, column_name, kind, choices, description) VALUES (?, ?, ?, ?, ?)`)
          .run(table, column.name, column.kind, column.choices ? JSON.stringify(column.choices) : null, column.description ?? "")
      }

      const insert = db.prepare(insertSql)
      for (const row of payload.rows) {
        const values = allColumnNames.map((columnName) => deserializeExportValue(row[columnName] ?? null))
        insert.run(...values)
      }
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    this.refreshColumnMetaCache()
  }

  private validateImportedColumns(columns: Column[]): void {
    if (columns.length === 0) {
      throw new Error("数据表导出文件缺少列")
    }

    const seenColumns = new Set<string>()
    for (const column of columns) {
      validateColumnName(column.name)
      validateColumnKind(column.kind)
      validateChoicesConsistency(column)
      const lower = column.name.toLowerCase()
      if (seenColumns.has(lower)) {
        throw new Error(`数据表导出文件包含重复列 "${column.name}"`)
      }
      seenColumns.add(lower)
    }
  }

  getDbPath(): string {
    return this.dbPath
  }
}

const databaseService = new DatabaseService()

export { databaseService }
