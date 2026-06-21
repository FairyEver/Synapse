import { DatabaseSync } from "node:sqlite"
import { app } from "electron"
import { copyFileSync, existsSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs"
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
  isChoiceKind,
  isColumnKind,
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
  toSqlValue,
} from "./type-coercion"
import { createMainLogger } from "../services/log-store"
import { buildWhere, buildOrderBy } from "./query-builder"
import { DATABASE_OPERATION_LOG_LIST_DEFAULT_LIMIT } from "../../database/shared/limits"
import {
  SYSTEM_COLUMN_NAMES,
  validateColumnName,
  validateMultiChoiceValue,
  validateName,
  validateSingleChoiceValue,
} from "./validators"
import { SchemaManager } from "./schema-manager"
import { ImportExportManager } from "./import-export"

const logger = createMainLogger("database.service")

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

type BulkMutationOptions = { dryRun?: boolean }

function isGroupedWhereClause(where: DatabaseWhereClause): where is { conditions: unknown[] } {
  return typeof where === "object"
    && where !== null
    && !Array.isArray(where)
    && "combinator" in where
    && "conditions" in where
    && Array.isArray((where as { conditions: unknown }).conditions)
}

function isEmptyWhereClause(where: DatabaseWhereClause | undefined): boolean {
  if (!where) return true
  if (Array.isArray(where)) return where.length === 0
  if (isGroupedWhereClause(where)) return where.conditions.length === 0
  return Object.keys(where).length === 0
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function toNumber(v: number | bigint): number {
  return typeof v === "bigint" ? Number(v) : v
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

const READ_ONLY_PRAGMA_NAMES = new Set([
  "application_id",
  "collation_list",
  "compile_options",
  "data_version",
  "database_list",
  "foreign_key_check",
  "foreign_key_list",
  "freelist_count",
  "function_list",
  "index_info",
  "index_list",
  "index_xinfo",
  "integrity_check",
  "module_list",
  "page_count",
  "pragma_list",
  "quick_check",
  "schema_version",
  "table_info",
  "table_list",
  "table_xinfo",
  "user_version",
])
const READ_ONLY_PRAGMA_ARGUMENT_NAMES = new Set([
  "foreign_key_check",
  "foreign_key_list",
  "index_info",
  "index_list",
  "index_xinfo",
  "integrity_check",
  "quick_check",
  "table_info",
  "table_list",
  "table_xinfo",
])

function referencesSystemTable(sql: string): boolean {
  const normalized = stripSqlLiteralsAndComments(sql).toLowerCase()
  return referencedSqlTableNames(normalized).some((table) => table.startsWith("_"))
}

function stripSqlLiteralsAndComments(sql: string): string {
  return sql
    .replace(/'([^']|'')*'/gu, "''")
    .replace(/--[^\r\n]*/gu, " ")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
}

function referencedSqlTableNames(normalizedSql: string): string[] {
  const names: string[] = []
  const tableReferencePattern =
    /\b(?:from|join|into|update|table)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:(?:main|temp)\.)?(?:"((?:[^"]|"")*)"|`([^`]*)`|\[([^\]]*)\]|([a-z_][a-z0-9_]*))/giu
  let match: RegExpExecArray | null
  while ((match = tableReferencePattern.exec(normalizedSql))) {
    const name = match[1]?.replace(/""/gu, "\"") ?? match[2] ?? match[3] ?? match[4]
    if (name) names.push(name)
  }

  const pragmaTablePattern =
    /\bpragma\s+(?:(?:main|temp)\.)?(?:table_info|table_xinfo|foreign_key_list|index_list)\s*\(\s*(?:"((?:[^"]|"")*)"|`([^`]*)`|\[([^\]]*)\]|([a-z_][a-z0-9_]*))/giu
  while ((match = pragmaTablePattern.exec(normalizedSql))) {
    const name = match[1]?.replace(/""/gu, "\"") ?? match[2] ?? match[3] ?? match[4]
    if (name) names.push(name)
  }

  return names
}

function isReadOnlyPragma(normalizedSql: string): boolean {
  const match = /^pragma\s+(?:(?:main|temp)\.)?([a-z_][a-z0-9_]*)\b/.exec(normalizedSql)
  if (!match) return false

  const pragmaName = match[1]
  if (!READ_ONLY_PRAGMA_NAMES.has(pragmaName)) return false

  const suffix = normalizedSql.slice(match[0].length).trim().replace(/;$/, "").trim()
  if (suffix.length === 0) return true
  if (!READ_ONLY_PRAGMA_ARGUMENT_NAMES.has(pragmaName)) return false
  if (suffix.includes("=") || suffix.includes(";")) return false
  return suffix.startsWith("(") && suffix.endsWith(")")
}

function isReadOnlySqlStatement(normalizedSql: string): boolean {
  return /^(select|explain)\b/.test(normalizedSql) || isReadOnlyPragma(normalizedSql)
}

function isVacuumIntoStatement(sql: string): boolean {
  const normalized = stripSqlLiteralsAndComments(sql).trim().toLowerCase()
  return /^vacuum\b[\s\S]*\binto\b/u.test(normalized)
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

class DatabaseService {
  private db: DatabaseSync | null = null
  private dbPath: string = ""
  private columnMeta: Map<string, ColumnMetaMap> = new Map()
  private schemaManager: SchemaManager | null = null
  private importExportManager: ImportExportManager | null = null

  open(): { corrupted: boolean } {
    const userDataPath = app.getPath("userData")
    this.migrateLegacyDatabaseFileName(userDataPath)
    this.dbPath = path.join(userDataPath, DATABASE_FILE_NAME)
    let corrupted = false

    try {
      this.db = new DatabaseSync(this.dbPath)
      this.db.exec("PRAGMA journal_mode=WAL")
    } catch (error) {
      throw new Error(`Failed to open database: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }

    try {
      this.assertDatabaseIntegrity(this.db)
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
    this.schemaManager = new SchemaManager(
      () => this.getDb(),
      (table) => this.getColumnMetaForTable(table),
      () => this.refreshColumnMetaCache(),
      (table) => this.columnMeta.delete(table),
      (table, column, entry) => {
        const existing = this.columnMeta.get(table) ?? new Map()
        existing.set(column, entry)
        this.columnMeta.set(table, existing)
      },
      (from, to) => {
        const meta = this.columnMeta.get(from)
        if (meta) {
          this.columnMeta.set(to, meta)
          this.columnMeta.delete(from)
        }
      },
    )
    this.importExportManager = new ImportExportManager(
      () => this.getDb(),
      () => this.dbPath,
      () => this.refreshColumnMetaCache(),
      (sourcePath) => this.reopenDatabaseFromSource(sourcePath),
      (table) => this.databaseTableDescribe(table),
    )

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
      throw new Error(`Failed to migrate legacy database file name: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
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
      try {
        this.restoreMovedFiles(moved)
        this.db = new DatabaseSync(this.dbPath)
        this.db.exec("PRAGMA journal_mode=WAL")
      } catch (restoreError) {
        logger.error("Failed to reopen current database after legacy recovery failure. Creating a fresh database.", { restoreError })
        this.backupAndReopenDatabase()
      }
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
    try { this.db?.close() } catch (error) { logger.warn("Failed to close database before backup.", { error }) }
    this.db = null

    const timestamp = Date.now()
    const suffix = `corrupt.${timestamp}`
    const walPath = `${this.dbPath}-wal`
    const shmPath = `${this.dbPath}-shm`
    const backupEntries = [
      { from: this.dbPath, to: `${this.dbPath}.${suffix}`, role: "database" },
      { from: walPath, to: `${walPath}.${suffix}`, role: "wal" },
      { from: shmPath, to: `${shmPath}.${suffix}`, role: "shm" },
    ].filter((entry) => existsSync(entry.from))
    const movedEntries: typeof backupEntries = []

    try {
      for (const entry of backupEntries) {
        renameSync(entry.from, entry.to)
        movedEntries.push(entry)
      }
    } catch (error) {
      for (const entry of movedEntries.reverse()) {
        try {
          if (!existsSync(entry.from) && existsSync(entry.to)) {
            renameSync(entry.to, entry.from)
          }
        } catch (rollbackError) {
          logger.warn("Failed to roll back corrupted database backup file.", {
            role: entry.role,
            error: rollbackError,
          })
        }
      }
      logger.error("Failed to backup corrupted database before recovery.", { error })
      throw new Error("Failed to backup corrupted database before recovery", { cause: error })
    }

    this.db = new DatabaseSync(this.dbPath)
    this.db.exec("PRAGMA journal_mode=WAL")
    this.assertDatabaseIntegrity(this.db)
  }

  private assertDatabaseIntegrity(db: DatabaseSync): void {
    const result = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[]
    if (result[0]?.integrity_check !== "ok") {
      throw new Error("Database integrity check failed")
    }
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
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_table_folders" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL UNIQUE,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        "created_at" TEXT NOT NULL
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_table_folder_members" (
        "folder_id" INTEGER NOT NULL,
        "table_name" TEXT NOT NULL UNIQUE,
        "sort_order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY ("folder_id", "table_name"),
        FOREIGN KEY ("folder_id") REFERENCES "_table_folders"("id") ON DELETE CASCADE
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

  private assertFolderExists(id: number): void {
    const db = this.getDb()
    const row = db.prepare(`SELECT COUNT(*) as count FROM "_table_folders" WHERE id = ?`).get(id) as { count: number }
    if (row.count === 0) {
      throw new Error(`Folder not found: ${id}`)
    }
  }

  private getSchemaManager(): SchemaManager {
    if (!this.schemaManager) {
      throw new Error("Database is not open")
    }
    return this.schemaManager
  }

  databaseTableList(): DatabaseTableInfo[] {
    const tables = this.getSchemaManager().databaseTableList()
    this.folderCleanupOrphans(tables.map((t) => t.name))
    return tables
  }

  databaseOverviewGet(): DatabaseOverview {
    return this.getSchemaManager().databaseOverviewGet()
  }

  databaseTableCreate(name: string, columns: Column[], description?: string): void {
    this.getSchemaManager().databaseTableCreate(name, columns, description)
  }

  databaseTableDelete(name: string): void {
    this.getSchemaManager().databaseTableDelete(name)
  }

  databaseTableDescribe(name: string): DatabaseTableSchema {
    return this.getSchemaManager().databaseTableDescribe(name)
  }

  databaseTableUpdate(table: string, description: string): void {
    this.getSchemaManager().databaseTableUpdate(table, description)
  }

  databaseColumnCreate(table: string, column: Column & { default?: unknown }): void {
    this.getSchemaManager().databaseColumnCreate(table, column)
  }

  databaseColumnUpdate(table: string, column: string, description: string): void {
    this.getSchemaManager().databaseColumnUpdate(table, column, description)
  }

  databaseChoiceUsageGet(table: string, column: string): Record<string, number> {
    return this.getSchemaManager().databaseChoiceUsageGet(table, column)
  }

  databaseChoiceUpdate(table: string, column: string, choices: string[]): void {
    this.getSchemaManager().databaseChoiceUpdate(table, column, choices)
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
    const countRow = db.prepare(countSQL).get(...whereParams) as { total: number | bigint }

    for (const row of rows) {
      parseReadRow(row, jsonCols, boolCols, multiChoiceCols)
    }

    return { rows, total: toNumber(countRow.total) }
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
    if (Object.keys(filtered).length === 0) {
      throw new Error("database.row.update requires at least one non-system field to update")
    }
    const withTimestamp: Record<string, unknown> = { ...filtered, updated_at: new Date().toISOString() }
    const keys = Object.keys(withTimestamp)
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

    if (isEmptyWhereClause(where)) {
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
    if (Object.keys(filtered).length === 0) {
      throw new Error("database.rows.update requires at least one non-system field to update")
    }
    const withTimestamp: Record<string, unknown> = { ...filtered, updated_at: new Date().toISOString() }
    const keys = Object.keys(withTimestamp)
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

    if (isEmptyWhereClause(where)) {
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

    if (referencesSystemTable(sql)) {
      throw new Error("Cannot operate on system tables (prefixed with _)")
    }
    if (/\b(attach|detach)\b/i.test(normalized)) {
      throw new Error("ATTACH and DETACH statements are not allowed")
    }
    if (isVacuumIntoStatement(sql)) {
      throw new Error("VACUUM INTO statements are not allowed")
    }

    const db = this.getDb()
    const isPragma = /^pragma\b/.test(normalized)
    if (isPragma && !isReadOnlyPragma(normalized)) {
      throw new Error("Mutating PRAGMA statements are not allowed")
    }

    const isRead = /^(select|explain)\b/.test(normalized) || isPragma
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
    if (!isReadOnlySqlStatement(normalized)) {
      throw new Error("database.sql.read is read-only. Use database.sql.execute when you explicitly need to write.")
    }
    if (/\b(attach|detach)\b/i.test(normalized)) {
      throw new Error("ATTACH and DETACH statements are not allowed")
    }
    if (referencesSystemTable(sql)) {
      throw new Error("Cannot read system tables (prefixed with _)")
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

  databaseLogList(limit = DATABASE_OPERATION_LOG_LIST_DEFAULT_LIMIT): DatabaseOperationLogEntry[] {
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
    this.getSchemaManager().databaseTableRename(from, to)
  }

  databaseColumnRename(table: string, from: string, to: string): void {
    this.getSchemaManager().databaseColumnRename(table, from, to)
  }

  databaseColumnDelete(table: string, column: string): void {
    this.getSchemaManager().databaseColumnDelete(table, column)
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

  private getImportExportManager(): ImportExportManager {
    if (!this.importExportManager) {
      throw new Error("Database is not open")
    }
    return this.importExportManager
  }

  private reopenDatabaseFromSource(sourcePath: string): void {
    const backupPath = `${this.dbPath}.import-backup.${Date.now()}`
    const walPath = `${this.dbPath}-wal`
    const shmPath = `${this.dbPath}-shm`
    let deleteBackup = false

    try {
      this.getDb().exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } catch { /* best effort */ }

    copyFileSync(this.dbPath, backupPath)
    this.close()

    try {
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
      deleteBackup = true
    } catch (error) {
      try {
        copyFileSync(backupPath, this.dbPath)
        this.db = new DatabaseSync(this.dbPath)
        this.db.exec("PRAGMA journal_mode=WAL")
        this.ensureSystemSchema()
        this.syncMetaTables()
        this.syncMetaColumns()
        this.refreshColumnMetaCache()
        deleteBackup = true
      } catch (restoreError) {
        logger.error("Failed to restore backup after import failure.", { restoreError })
        this.reopenCurrentDatabaseAfterImportFailure()
      }
      throw error
    } finally {
      if (deleteBackup) {
        try { unlinkSync(backupPath) } catch (error) { logger.warn("Failed to delete temp backup.", { error }) }
      }
    }
  }

  private reopenCurrentDatabaseAfterImportFailure(): void {
    if (this.db) return
    if (!existsSync(this.dbPath)) return

    try {
      this.db = new DatabaseSync(this.dbPath)
      this.db.exec("PRAGMA journal_mode=WAL")
      this.ensureSystemSchema()
      this.syncMetaTables()
      this.syncMetaColumns()
      this.refreshColumnMetaCache()
    } catch (reopenError) {
      logger.error("Failed to reopen database after import restore failure.", { reopenError })
      if (this.db) {
        try {
          this.db.close()
        } catch (closeError) {
          logger.warn("Failed to close database after import reopen failure.", { closeError })
        }
      }
      this.db = null
    }
  }

  exportDatabase(targetPath: string): void {
    this.getImportExportManager().exportDatabase(targetPath)
  }

  importDatabase(sourcePath: string): void {
    this.getImportExportManager().importDatabase(sourcePath)
  }

  exportTable(table: string, targetPath: string): void {
    this.getImportExportManager().exportTable(table, targetPath)
  }

  inspectTableImport(sourcePath: string): DatabaseTableImportInspection {
    return this.getImportExportManager().inspectTableImport(sourcePath)
  }

  importTable(sourcePath: string, sourceDigest?: string): string {
    return this.getImportExportManager().importTable(sourcePath, sourceDigest)
  }

  getDbPath(): string {
    return this.dbPath
  }

  // ── Folder methods ──────────────────────────────────────────────────────────

  folderList(): { id: number; name: string; sortOrder: number; members: { tableName: string; sortOrder: number }[] }[] {
    const db = this.getDb()
    const folders = db.prepare(`SELECT id, name, sort_order FROM "_table_folders" ORDER BY sort_order, id`).all() as {
      id: number | bigint
      name: string
      sort_order: number | bigint
    }[]
    const members = db.prepare(`SELECT folder_id, table_name, sort_order FROM "_table_folder_members" ORDER BY sort_order`).all() as {
      folder_id: number | bigint
      table_name: string
      sort_order: number | bigint
    }[]
    const membersByFolder = new Map<number, { tableName: string; sortOrder: number }[]>()
    for (const m of members) {
      const fid = toNumber(m.folder_id)
      const list = membersByFolder.get(fid) ?? []
      list.push({ tableName: m.table_name, sortOrder: toNumber(m.sort_order) })
      membersByFolder.set(fid, list)
    }
    return folders.map((f) => ({
      id: toNumber(f.id),
      name: f.name,
      sortOrder: toNumber(f.sort_order),
      members: membersByFolder.get(toNumber(f.id)) ?? [],
    }))
  }

  folderCreate(name: string): { id: number } {
    const db = this.getDb()
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Folder name cannot be empty")
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM "_table_folders"`).get() as { m: number | bigint | null }
    const sortOrder = (maxOrder?.m != null ? toNumber(maxOrder.m) : -1) + 1
    const now = new Date().toISOString()
    const result = db.prepare(
      `INSERT INTO "_table_folders" ("name", "sort_order", "created_at") VALUES (?, ?, ?)`
    ).run(trimmed, sortOrder, now)
    return { id: toNumber(result.lastInsertRowid) }
  }

  folderRename(id: number, name: string): void {
    const db = this.getDb()
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Folder name cannot be empty")
    const result = db.prepare(`UPDATE "_table_folders" SET name = ? WHERE id = ?`).run(trimmed, id)
    if (result.changes === 0) throw new Error(`Folder not found: ${id}`)
  }

  folderDelete(id: number): void {
    const db = this.getDb()
    db.exec("PRAGMA foreign_keys=ON")
    const result = db.prepare(`DELETE FROM "_table_folders" WHERE id = ?`).run(id)
    if (result.changes === 0) throw new Error(`Folder not found: ${id}`)
  }

  folderMoveTable(tableName: string, folderId: number | null): void {
    const db = this.getDb()
    this.assertTableExists(tableName)
    if (folderId !== null) {
      this.assertFolderExists(folderId)
    }
    db.prepare(`DELETE FROM "_table_folder_members" WHERE table_name = ?`).run(tableName)
    if (folderId !== null) {
      const maxOrder = db.prepare(
        `SELECT MAX(sort_order) as m FROM "_table_folder_members" WHERE folder_id = ?`
      ).get(folderId) as { m: number | bigint | null }
      const sortOrder = (maxOrder?.m != null ? toNumber(maxOrder.m) : -1) + 1
      db.prepare(
        `INSERT INTO "_table_folder_members" ("folder_id", "table_name", "sort_order") VALUES (?, ?, ?)`
      ).run(folderId, tableName, sortOrder)
    }
  }

  folderReorder(folderId: number, tableNames: string[]): void {
    const db = this.getDb()
    const update = db.prepare(`UPDATE "_table_folder_members" SET sort_order = ? WHERE folder_id = ? AND table_name = ?`)
    for (let i = 0; i < tableNames.length; i++) {
      update.run(i, folderId, tableNames[i])
    }
  }

  folderReorderFolders(folderIds: number[]): void {
    const db = this.getDb()
    for (const folderId of folderIds) {
      if (!Number.isInteger(folderId)) {
        throw new Error("Folder id must be an integer")
      }
    }

    const currentFolders = db.prepare(`SELECT id FROM "_table_folders" ORDER BY id`).all() as {
      id: number | bigint
    }[]
    const currentIds = new Set(currentFolders.map((folder) => toNumber(folder.id)))
    const seenIds = new Set<number>()

    if (folderIds.length !== currentIds.size) {
      throw new Error("folderIds must contain every folder id exactly once")
    }

    for (const folderId of folderIds) {
      if (seenIds.has(folderId)) {
        throw new Error(`Duplicate folder id: ${folderId}`)
      }
      if (!currentIds.has(folderId)) {
        throw new Error(`Unknown folder id: ${folderId}`)
      }
      seenIds.add(folderId)
    }

    const update = db.prepare(`UPDATE "_table_folders" SET sort_order = ? WHERE id = ?`)
    for (let i = 0; i < folderIds.length; i++) {
      const result = update.run(i, folderIds[i])
      if (result.changes === 0) {
        throw new Error(`Folder not found: ${folderIds[i]}`)
      }
    }
  }

  folderCleanupOrphans(existingTableNames: string[]): void {
    const db = this.getDb()
    if (existingTableNames.length === 0) {
      db.exec(`DELETE FROM "_table_folder_members"`)
      return
    }
    const placeholders = existingTableNames.map(() => "?").join(",")
    db.prepare(
      `DELETE FROM "_table_folder_members" WHERE table_name NOT IN (${placeholders})`
    ).run(...existingTableNames)
  }
}

const databaseService = new DatabaseService()

export { databaseService }
