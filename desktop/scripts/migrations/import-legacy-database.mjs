#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite"
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"

const DB_FILE = "synapse-database.db"
const SYSTEM_COLUMNS = new Set(["id", "created_at", "updated_at"])
const CHOICE_KINDS = new Set(["single_choice", "multi_choice"])

const LEGACY_TYPE_TO_KIND = new Map([
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

const KIND_TO_AFFINITY = new Map([
  ["text", "TEXT"],
  ["integer", "INTEGER"],
  ["decimal", "REAL"],
  ["boolean", "INTEGER"],
  ["date", "TEXT"],
  ["timestamp", "TEXT"],
  ["single_choice", "TEXT"],
  ["multi_choice", "TEXT"],
  ["json", "TEXT"],
  ["binary", "BLOB"],
])

function usage() {
  console.log(`Import a legacy Synapse database database into the current kind/choices schema.

Usage:
  ./migrate-legacy-database-macos.sh [--dry-run] [--force]
  node import-legacy-database.mjs [--source <path>] [--target <path>] [--dry-run] [--force]
  pnpm --filter @synapse/desktop run database:import-legacy -- [--source <path>] [--target <path>] [--dry-run] [--force]

Options:
  --source <path>  Legacy database. Defaults to the newest synapse-data.db.legacy.* file.
  --target <path>  Current database. Defaults to the Synapse userData synapse-database.db.
  --dry-run        Print the conversion plan without writing files.
  --force          Replace a non-empty target database. The old target is still backed up.

Open the new Synapse once, close Synapse, then run the real import.`)
}

function parseArgs(argv) {
  const options = {
    source: "",
    target: "",
    dryRun: false,
    force: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--") continue
    if (arg === "--help" || arg === "-h") {
      usage()
      process.exit(0)
    }
    if (arg === "--source") {
      const value = argv[i + 1]
      if (!value || value.startsWith("--")) throw new Error("--source requires a path")
      options.source = value
      i += 1
      continue
    }
    if (arg === "--target") {
      const value = argv[i + 1]
      if (!value || value.startsWith("--")) throw new Error("--target requires a path")
      options.target = value
      i += 1
      continue
    }
    if (arg === "--dry-run") {
      options.dryRun = true
      continue
    }
    if (arg === "--force") {
      options.force = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function getUserDataPath() {
  switch (process.platform) {
    case "darwin":
      return path.join(homedir(), "Library", "Application Support", "Synapse")
    case "win32":
      return path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "Synapse")
    default:
      return path.join(homedir(), ".config", "Synapse")
  }
}

function q(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

function isSynapseRunning(userDataPath) {
  const infoPath = path.join(userDataPath, "data-server.json")
  if (!existsSync(infoPath)) return false

  try {
    const raw = JSON.parse(readFileSync(infoPath, "utf-8"))
    if (!Number.isInteger(raw.pid)) return false
    return isProcessAlive(raw.pid)
  } catch {
    return false
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (process.platform === "win32") {
    try {
      const output = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      })
      return output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .some((line) => line.startsWith("\"") && parseCsvLine(line)[1] === String(pid))
    } catch {
      return true
    }
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === "ESRCH") return false
    if (error?.code === "EPERM") return true
    return true
  }
}

function parseCsvLine(line) {
  const fields = []
  let current = ""
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\""
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (character === "," && !inQuotes) {
      fields.push(current)
      current = ""
      continue
    }
    current += character
  }
  fields.push(current)
  return fields
}

function findLatestLegacySource(userDataPath) {
  if (!existsSync(userDataPath)) return ""

  const candidates = readdirSync(userDataPath)
    .map((name) => {
      const match = name.match(/^synapse-data\.db\.legacy\.(\d+)$/)
      if (!match) return null
      const filePath = path.join(userDataPath, name)
      if (!statSync(filePath).isFile()) return null
      return { filePath, timestamp: Number(match[1]) }
    })
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp)

  return candidates[0]?.filePath ?? ""
}

function prepareSourceForRead(source) {
  const match = path.basename(source).match(/^synapse-data\.db\.legacy\.(\d+)$/)
  if (!match) return { path: source, cleanup: () => {}, copied: false }

  const timestamp = match[1]
  const dir = path.dirname(source)
  const legacyWal = path.join(dir, `synapse-data.db-wal.legacy.${timestamp}`)
  const legacyShm = path.join(dir, `synapse-data.db-shm.legacy.${timestamp}`)
  if (!existsSync(legacyWal)) return { path: source, cleanup: () => {}, copied: false }

  const tempBase = path.join(tmpdir(), `synapse-legacy-import-source.${Date.now()}.db`)
  copyFileSync(source, tempBase)
  copyFileSync(legacyWal, `${tempBase}-wal`)
  if (existsSync(legacyShm)) copyFileSync(legacyShm, `${tempBase}-shm`)

  return {
    path: tempBase,
    cleanup: () => cleanupTemp(tempBase),
    copied: true,
  }
}

function assertLegacySource(db) {
  const metaTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('_meta_tables', '_meta_columns')").all()
  const names = new Set(metaTables.map((row) => row.name))
  if (!names.has("_meta_tables") || !names.has("_meta_columns")) {
    throw new Error("Source is not a Synapse database database: metadata tables are missing.")
  }

  const columns = db.prepare(`PRAGMA table_info("_meta_columns")`).all()
  const columnNames = new Set(columns.map((row) => row.name))
  if (columnNames.has("kind")) {
    throw new Error("Source already uses the current kind/choices schema.")
  }
  if (!columnNames.has("enum_values")) {
    throw new Error("Source is not a supported legacy schema: _meta_columns.enum_values is missing.")
  }
}

function getUserTables(db) {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type='table'
      AND name NOT LIKE '\\_%' ESCAPE '\\'
      AND name != 'sqlite_sequence'
    ORDER BY name
  `).all().map((row) => row.name)
}

function readMetaTables(db) {
  const rows = db.prepare(`SELECT name, description, created_at, updated_at FROM "_meta_tables"`).all()
  return new Map(rows.map((row) => [row.name, row]))
}

function readLegacyColumnMeta(db, table) {
  const rows = db.prepare(`
    SELECT column_name, description, enum_values
    FROM "_meta_columns"
    WHERE table_name = ?
  `).all(table)

  return new Map(rows.map((row) => [row.column_name, row]))
}

function affinityToKind(type) {
  const upper = String(type ?? "").toUpperCase()
  if (upper.startsWith("INT")) return "integer"
  if (upper.includes("REAL") || upper.includes("FLOA") || upper.includes("DOUB")) return "decimal"
  if (upper.includes("BLOB")) return "binary"
  return "text"
}

function legacyTypeToKind(type, parsedChoices) {
  const upper = String(type ?? "").toUpperCase()
  const kind = LEGACY_TYPE_TO_KIND.get(upper) ?? affinityToKind(upper)
  if (parsedChoices.length > 0 && kind !== "multi_choice") return "single_choice"
  return kind
}

function kindToAffinity(kind) {
  return KIND_TO_AFFINITY.get(kind) ?? "TEXT"
}

function parseChoices(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return uniqueStrings(parsed)
  } catch {
    return []
  }
}

function uniqueStrings(values) {
  const seen = new Set()
  const result = []
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function inferChoices(db, table, column, kind) {
  if (kind === "single_choice") {
    const rows = db.prepare(`
      SELECT DISTINCT ${q(column)} AS value
      FROM ${q(table)}
      WHERE ${q(column)} IS NOT NULL AND ${q(column)} != ''
      ORDER BY ${q(column)}
    `).all()
    return uniqueStrings(rows.map((row) => String(row.value)))
  }

  const choices = []
  const rows = db.prepare(`
    SELECT ${q(column)} AS value
    FROM ${q(table)}
    WHERE ${q(column)} IS NOT NULL AND ${q(column)} != ''
  `).all()

  for (const row of rows) {
    try {
      const parsed = JSON.parse(String(row.value))
      if (Array.isArray(parsed)) choices.push(...parsed)
    } catch {
      // Old MULTI_ENUM values were JSON arrays; malformed rows cannot reveal choices.
    }
  }

  return uniqueStrings(choices).sort((a, b) => a.localeCompare(b))
}

function collectPlan(sourceDb) {
  const now = new Date().toISOString()
  const metaTables = readMetaTables(sourceDb)
  const tables = []

  for (const table of getUserTables(sourceDb)) {
    const tableMeta = metaTables.get(table) ?? {
      description: "",
      created_at: now,
      updated_at: now,
    }
    const columnMeta = readLegacyColumnMeta(sourceDb, table)
    const pragmaRows = sourceDb.prepare(`PRAGMA table_info(${q(table)})`).all()
    const columns = []

    for (const row of pragmaRows) {
      const system = SYSTEM_COLUMNS.has(row.name)
      const meta = columnMeta.get(row.name)
      const parsedChoices = parseChoices(meta?.enum_values ?? "")
      const kind = system ? systemColumnKind(row.name) : legacyTypeToKind(row.type, parsedChoices)
      let choices = parsedChoices

      if (!system && CHOICE_KINDS.has(kind) && choices.length === 0) {
        choices = inferChoices(sourceDb, table, row.name, kind)
        if (choices.length === 0) {
          throw new Error(`Cannot infer choices for ${table}.${row.name}. Add enum_values in the legacy DB or convert this column manually.`)
        }
      }

      columns.push({
        name: row.name,
        legacyType: row.type,
        kind,
        affinity: kindToAffinity(kind),
        description: meta?.description ?? "",
        choices,
        system,
        notnull: row.notnull === 1,
        dfltValue: row.dflt_value,
      })
    }

    const countRow = sourceDb.prepare(`SELECT COUNT(*) AS count FROM ${q(table)}`).get()
    tables.push({
      name: table,
      description: tableMeta.description ?? "",
      createdAt: tableMeta.created_at ?? now,
      updatedAt: tableMeta.updated_at ?? now,
      rowCount: Number(countRow?.count ?? 0),
      columns,
    })
  }

  return { tables }
}

function systemColumnKind(name) {
  if (name === "id") return "integer"
  return "timestamp"
}

function createSystemSchema(db) {
  db.exec(`
    CREATE TABLE "_meta_tables" (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE "_meta_columns" (
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      choices TEXT,
      description TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (table_name, column_name)
    )
  `)
}

function columnDefinition(column) {
  if (column.name === "id") return `"id" INTEGER PRIMARY KEY AUTOINCREMENT`
  if (column.name === "created_at" || column.name === "updated_at") {
    return `${q(column.name)} TEXT NOT NULL DEFAULT ''`
  }

  let sql = `${q(column.name)} ${column.affinity}`
  if (column.notnull) sql += " NOT NULL"
  if (column.dfltValue !== null && column.dfltValue !== undefined) sql += ` DEFAULT ${column.dfltValue}`
  return sql
}

function convertLegacyValue(value, column) {
  if (value === null || value === undefined) return value
  if (String(column.legacyType).toUpperCase() === "DATETIME" && typeof value === "string") {
    return value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/, "$1T$2")
  }
  return value
}

function writeConvertedDatabase(sourceDb, targetDb, plan) {
  targetDb.exec("PRAGMA foreign_keys=OFF")
  targetDb.exec("BEGIN")

  try {
    createSystemSchema(targetDb)

    for (const table of plan.tables) {
      const createSql = `CREATE TABLE ${q(table.name)} (${table.columns.map(columnDefinition).join(", ")})`
      targetDb.exec(createSql)
      targetDb.prepare(`
        INSERT INTO "_meta_tables" (name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(table.name, table.description, table.createdAt, table.updatedAt)

      for (const column of table.columns) {
        if (column.system) continue
        targetDb.prepare(`
          INSERT INTO "_meta_columns" (table_name, column_name, kind, choices, description)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          table.name,
          column.name,
          column.kind,
          CHOICE_KINDS.has(column.kind) ? JSON.stringify(column.choices) : null,
          column.description,
        )
      }

      copyRows(sourceDb, targetDb, table)
    }

    targetDb.exec("COMMIT")
  } catch (error) {
    targetDb.exec("ROLLBACK")
    throw error
  }
}

function copyRows(sourceDb, targetDb, table) {
  if (table.rowCount === 0) return

  const columnNames = table.columns.map((column) => column.name)
  const columnList = columnNames.map(q).join(", ")
  const placeholders = columnNames.map(() => "?").join(", ")
  const selectRows = sourceDb.prepare(`SELECT ${columnList} FROM ${q(table.name)} ORDER BY ${columnNames.includes("id") ? q("id") : "rowid"}`).all()
  const insert = targetDb.prepare(`INSERT INTO ${q(table.name)} (${columnList}) VALUES (${placeholders})`)

  for (const row of selectRows) {
    insert.run(...table.columns.map((column) => convertLegacyValue(row[column.name], column)))
  }
}

function inspectTarget(targetPath) {
  if (!existsSync(targetPath)) return { exists: false, userTables: [] }

  let db
  try {
    db = new DatabaseSync(targetPath, { readOnly: true })
    return { exists: true, userTables: getUserTables(db) }
  } finally {
    db?.close()
  }
}

function moveIfExists(filePath, suffix) {
  if (!existsSync(filePath)) return ""
  const nextPath = `${filePath}.${suffix}`
  renameSync(filePath, nextPath)
  return nextPath
}

function cleanupTemp(basePath) {
  for (const filePath of [basePath, `${basePath}-wal`, `${basePath}-shm`]) {
    try {
      if (existsSync(filePath)) unlinkSync(filePath)
    } catch {
      // Best effort cleanup.
    }
  }
}

function printPlan(plan, source, target, dryRun) {
  console.log(`Source: ${source}`)
  console.log(`Target: ${target}`)
  console.log(`Mode: ${dryRun ? "dry-run" : "import"}`)
  console.log("")

  if (plan.tables.length === 0) {
    console.log("No user tables found.")
    return
  }

  console.log("Tables:")
  for (const table of plan.tables) {
    console.log(`- ${table.name}: ${table.rowCount} rows`)
    for (const column of table.columns) {
      if (column.system) continue
      const choices = CHOICE_KINDS.has(column.kind) ? `, choices=${column.choices.length}` : ""
      console.log(`  ${column.name}: ${column.legacyType} -> ${column.kind}${choices}`)
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const userDataPath = getUserDataPath()
  const source = options.source || findLatestLegacySource(userDataPath)
  const target = options.target || path.join(userDataPath, DB_FILE)

  if (!source) throw new Error(`No legacy database found under ${userDataPath}. Open the new Synapse once so it backs up the old database, close Synapse, then rerun this script.`)
  if (!existsSync(source)) throw new Error(`Source database not found: ${source}`)
  if (path.resolve(source) === path.resolve(target)) {
    throw new Error("Source and target must be different files.")
  }

  if (!options.dryRun && path.resolve(target) === path.resolve(path.join(userDataPath, DB_FILE)) && isSynapseRunning(userDataPath)) {
    throw new Error("Synapse is running. Close Synapse before importing the legacy database.")
  }

  let sourceDb
  let targetDb
  let preparedSource
  const timestamp = Date.now()
  const tempPath = `${target}.importing.${timestamp}`

  try {
    preparedSource = prepareSourceForRead(source)
    sourceDb = preparedSource.copied
      ? new DatabaseSync(preparedSource.path)
      : new DatabaseSync(preparedSource.path, { readOnly: true })
    assertLegacySource(sourceDb)
    const plan = collectPlan(sourceDb)
    printPlan(plan, source, target, options.dryRun)

    if (options.dryRun) {
      console.log("")
      console.log("Dry run completed. No files changed.")
      return
    }

    const targetInfo = inspectTarget(target)
    if (targetInfo.userTables.length > 0 && !options.force) {
      throw new Error(`Target database already has user tables: ${targetInfo.userTables.join(", ")}. Re-run with --force to replace it after backup.`)
    }

    mkdirSync(path.dirname(target), { recursive: true })
    cleanupTemp(tempPath)
    targetDb = new DatabaseSync(tempPath)
    targetDb.exec("PRAGMA journal_mode=DELETE")
    writeConvertedDatabase(sourceDb, targetDb, plan)
    targetDb.exec("VACUUM")
    targetDb.close()
    targetDb = null

    const backupSuffix = `before-legacy-import.${timestamp}`
    const backups = [
      moveIfExists(target, backupSuffix),
      moveIfExists(`${target}-wal`, backupSuffix),
      moveIfExists(`${target}-shm`, backupSuffix),
    ].filter(Boolean)

    renameSync(tempPath, target)

    console.log("")
    console.log(`Imported ${plan.tables.length} table(s) into ${target}`)
    if (backups.length > 0) {
      console.log("Backed up previous target files:")
      for (const backup of backups) console.log(`- ${backup}`)
    }
  } finally {
    targetDb?.close()
    sourceDb?.close()
    cleanupTemp(tempPath)
    preparedSource?.cleanup()
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
