import type { DatabaseSync } from "node:sqlite"
import type { SQLInputValue } from "node:sqlite"
import type {
  Column,
  ColumnKind,
  DatabaseOverview,
  DatabaseTableInfo,
  DatabaseTableSchema,
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
  toBooleanInt,
  toSqlValue,
  validateDateString,
  validateTimestampString,
  getChoiceColumns,
  getMultiChoiceColumns,
} from "./type-coercion"
import {
  assertSemanticallyCorrectColumn,
  validateChoicesConsistency,
  validateColumnKind,
  validateColumnName,
  validateName,
} from "./validators"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
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

// ---------------------------------------------------------------------------
// SchemaManager
// ---------------------------------------------------------------------------

export class SchemaManager {
  constructor(
    private getDb: () => DatabaseSync,
    private getColumnMeta: (table: string) => ColumnMetaMap,
    private refreshColumnMetaCache: () => void,
    private deleteColumnMetaEntry: (table: string) => void,
    private setColumnMetaEntry: (table: string, column: string, entry: { kind: ColumnKind; choices?: string[] }) => void,
    private renameColumnMetaTable: (from: string, to: string) => void,
  ) {}

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

    this.deleteColumnMetaEntry(name)
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

    this.renameColumnMetaTable(from, to)
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

  databaseChoiceUsageGet(table: string, column: string): Record<string, number> {
    validateName(table, "table")
    validateColumnName(column)
    this.assertTableExists(table)

    const choiceCols = getChoiceColumns(this.getColumnMeta(table))
    const allowed = choiceCols.get(column)
    if (!allowed) {
      throw new Error(`Column "${column}" is not a single_choice or multi_choice column`)
    }

    const db = this.getDb()
    const isMultiChoice = getMultiChoiceColumns(this.getColumnMeta(table)).has(column)
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
    const meta = this.getColumnMeta(table).get(column)
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

    this.setColumnMetaEntry(table, column, { kind: meta.kind, choices })
  }
}
