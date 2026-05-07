import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import type { Column, DatabaseTableImportInspection } from "./types"
import { kindToAffinity } from "./column-kind"
import {
  validateChoicesConsistency,
  validateColumnKind,
  validateColumnName,
  validateName,
} from "./validators"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("database.import-export")

// ---------------------------------------------------------------------------
// Export format constants
// ---------------------------------------------------------------------------

const TABLE_EXPORT_FORMAT = "synapse-table-sql"
const TABLE_EXPORT_VERSION = 1
const TABLE_EXPORT_BEGIN_MARKER = "-- synapse-table-export-b64"
const TABLE_EXPORT_END_MARKER = "-- synapse-table-export-end"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ImportExportManager
// ---------------------------------------------------------------------------

export class ImportExportManager {
  constructor(
    private getDb: () => DatabaseSync,
    private getDbPath: () => string,
    private refreshColumnMetaCache: () => void,
    private reopenDatabase: (sourcePath: string) => void,
    private databaseTableDescribe: (table: string) => {
      name: string
      description: string
      columns: Column[]
      createdAt: string
      updatedAt: string
    },
  ) {}

  exportDatabase(targetPath: string): void {
    const db = this.getDb()
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    copyFileSync(this.getDbPath(), targetPath)
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

    this.reopenDatabase(sourcePath)
    logger.info("Database imported.", { source: sourcePath })
  }

  exportTable(table: string, targetPath: string): void {
    validateName(table, "table")

    const db = this.getDb()
    const schema = this.databaseTableDescribe(table)
    const userColumns = schema.columns.filter((column) => !("system" in column && column.system) && !("primaryKey" in column && column.primaryKey))
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
}
