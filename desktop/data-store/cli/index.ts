#!/usr/bin/env node

const [major] = process.versions.node.split(".").map(Number)
if (major < 18) {
  console.error(`Error: synapse requires Node.js >= 18.0.0 (current: ${process.versions.node})`)
  process.exit(1)
}

import { apiCall, isAppRunning, readServerInfo, type ServerInfo } from "../shared/resolve-user-data"
import { getCliDataCommands } from "../shared/capability-registry"

function printTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log("(no rows)")
    return
  }

  const keys = Object.keys(rows[0])
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => formatValue(r[k]).length)))

  const header = keys.map((k, i) => k.padEnd(widths[i])).join("  ")
  const separator = widths.map((w) => "─".repeat(w)).join("──")

  console.log(header)
  console.log(separator)
  for (const row of rows) {
    console.log(keys.map((k, i) => formatValue(row[k]).padEnd(widths[i])).join("  "))
  }
}

function formatValue(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

const COLUMN_KINDS = new Set([
  "text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "timestamp",
  "single_choice",
  "multi_choice",
  "json",
  "binary",
])

const OLD_KIND_HINTS: Record<string, string> = {
  TEXT: "text",
  INTEGER: "integer",
  REAL: "decimal",
  BOOLEAN: "boolean",
  DATE: "date",
  DATETIME: "timestamp",
  ENUM: "single_choice",
  MULTI_ENUM: "multi_choice",
  JSON: "json",
  BLOB: "binary",
}

function parseColDef(s: string): { name: string; kind: string; choices?: string[] } {
  const parts = s.split(":")
  const [name, kind, choicesRaw] = parts
  if (!name || !kind || parts.length > 3) {
    console.error(`Invalid column definition: "${s}". Expected format: name:kind or name:kind:v1,v2,v3`)
    process.exit(1)
  }

  if (!COLUMN_KINDS.has(kind)) {
    const replacement = OLD_KIND_HINTS[kind.toUpperCase()]
    if (replacement) {
      console.error(`Unsupported column kind "${kind}". Use "${replacement}" instead.`)
    } else {
      console.error(`Unsupported column kind "${kind}". Use one of: ${Array.from(COLUMN_KINDS).join(", ")}`)
    }
    process.exit(1)
  }

  const isChoiceKind = kind === "single_choice" || kind === "multi_choice"
  const choices = choicesRaw
    ? choicesRaw.split(",").map((item) => item.trim()).filter(Boolean)
    : undefined
  if (isChoiceKind && (!choices || choices.length === 0)) {
    console.error(`Column "${name}" with kind "${kind}" requires choices: ${name}:${kind}:v1,v2,v3`)
    process.exit(1)
  }
  if (!isChoiceKind && choicesRaw !== undefined) {
    console.error(`Column "${name}" has choices but kind "${kind}" does not use choices.`)
    process.exit(1)
  }

  return choices ? { name, kind, choices } : { name, kind }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const value = args[idx + 1]
  if (value === undefined || value.startsWith("--")) {
    console.error(`Missing value for ${flag}`)
    process.exit(1)
  }
  return value
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    console.error(`Invalid JSON for ${label}.`)
    process.exit(1)
  }
}

function parseJsonFlag(args: string[], flag: string): unknown | undefined {
  const value = getFlagValue(args, flag)
  return value === undefined ? undefined : parseJsonValue(value, flag)
}

function parseWherePairs(args: string[]): Record<string, string> | undefined {
  const whereIdx = args.indexOf("--where")
  if (whereIdx === -1) return undefined

  const where: Record<string, string> = {}
  for (let i = whereIdx + 1; i < args.length; i++) {
    if (args[i].startsWith("--")) break
    const eqIdx = args[i].indexOf("=")
    if (eqIdx === -1) {
      console.error(`Invalid --where value: "${args[i]}". Expected format: key=value`)
      process.exit(1)
    }
    const key = args[i].slice(0, eqIdx)
    const value = args[i].slice(eqIdx + 1)
    if (key) where[key] = value
  }

  return where
}

function parseWhere(args: string[]): unknown | undefined {
  const whereJson = parseJsonFlag(args, "--where-json")
  return whereJson === undefined ? parseWherePairs(args) : whereJson
}

function parseNonNegativeIntegerFlag(args: string[], flag: string): number | undefined {
  const value = getFlagValue(args, flag)
  if (value === undefined) return undefined

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    console.error(`Invalid ${flag} value: expected a non-negative integer`)
    process.exit(1)
  }
  return parsed
}

function parseOrderBy(args: string[]): string | { field: string; dir: "asc" | "desc" } | undefined {
  const field = getFlagValue(args, "--order-by")
  if (field === undefined) return undefined

  const dir = getFlagValue(args, "--order-dir")
  if (dir === undefined) return field
  if (dir !== "asc" && dir !== "desc") {
    console.error("Invalid --order-dir value: expected asc or desc")
    process.exit(1)
  }
  return { field, dir }
}

function parseChoicesValue(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith("[")) {
    const parsed = parseJsonValue(trimmed, "choices")
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      console.error("Invalid choices value: expected a JSON array of strings")
      process.exit(1)
    }
    return parsed
  }

  const choices = value.split(",").map((item) => item.trim()).filter(Boolean)
  if (choices.length === 0) {
    console.error("Invalid choices value: expected at least one choice")
    process.exit(1)
  }
  return choices
}

function parseDataFlag(args: string[], flag = "--data"): unknown {
  const value = getFlagValue(args, flag)
  if (value === undefined) {
    console.error(`Missing ${flag}`)
    process.exit(1)
  }
  return parseJsonValue(value, flag)
}

function columnArgsForCreate(args: string[]): string[] {
  const flagIdx = args.findIndex((item, index) => index >= 2 && item.startsWith("--"))
  return flagIdx === -1 ? args.slice(2) : args.slice(2, flagIdx)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === "help" || command === "--help") {
    console.log(`synapse - Synapse Data Store CLI

Usage:
  synapse tables                                     List all tables
  synapse overview                                   Show all tables and column summaries
  synapse create <name> <col:kind> [...] [--description "..."]  Create a table
  synapse drop <name>                                Drop a table
  synapse describe <name>                            Describe table schema
  synapse update-table-description <table> <desc>    Update table description
  synapse add-column <table> <col:kind> [--description "..."]  Add a column
  synapse drop-column <table> <column>               Drop a column
  synapse rename-table <from> <to>                   Rename a table
  synapse rename-column <table> <from> <to>          Rename a column
  synapse update-column-description <table> <col> <desc>  Update column description
  synapse update-column-choices <table> <col> <choices>  Replace choice metadata
  synapse choice-usage <table> <col>                 Show choice usage counts
  synapse insert <table> --data '{"k":"v"}'          Insert a row
  synapse insert <table> --batch '[{...}]'           Batch insert
  synapse query <table> [--where k=v] [--where-json '{...}'] [--limit N]  Query rows
  synapse count <table> [--where k=v] [--where-json '{...}']  Count rows
  synapse operation-log [--limit N]                  Show recent Data Store mutations
  synapse update <table> <id> --data '{"k":"v"}'     Update a row
  synapse update-where <table> --where-json '{...}' --data '{"k":"v"}' [--dry-run]  Update rows
  synapse delete <table> <id>                        Delete a row
  synapse delete-where <table> --where-json '{...}' [--dry-run]  Delete rows
  synapse read-sql '<SQL>' [--params '[...]']        Execute read-only SQL
  synapse sql '<SQL>' [--params '[...]']             Execute raw SQL
  synapse status                                     Show service status

Column kinds:
  text, integer, decimal, boolean, date, timestamp,
  single_choice, multi_choice, json, binary

Choice columns:
  synapse create todo title:text priority:single_choice:high,medium,low tags:multi_choice:work,study,home done:boolean due:date`)
    return
  }

  const KNOWN_COMMANDS = new Set([...getCliDataCommands(), "status"])
  if (!KNOWN_COMMANDS.has(command)) {
    console.error(`Unknown command: ${command}\nRun "synapse help" for usage.`)
    process.exit(1)
  }

  if (command === "status") {
    let info: ServerInfo | null = null
    try {
      info = readServerInfo()
    } catch { /* ignore */ }

    if (!info) {
      console.log("Port: -")
      console.log("PID: -")
      console.log("Started: -")
      console.log("Running: no")
      return
    }

    const running = isAppRunning(info.pid)
    console.log(`Port: ${info.port}`)
    console.log(`PID: ${info.pid}`)
    console.log(`Started: ${info.startedAt}`)
    console.log(`Running: ${running ? "yes" : "no"}`)
    return
  }

  let info: ServerInfo
  try {
    info = readServerInfo()
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }

  if (!isAppRunning(info.pid)) {
    console.error("Synapse app is not running. Please start Synapse first.")
    process.exit(1)
  }

  try {
    switch (command) {
      case "tables": {
        const result = await apiCall(info, "listTables") as { data: unknown[] }
        printTable(result.data as Record<string, unknown>[])
        break
      }

      case "overview": {
        const result = await apiCall(info, "databaseOverview") as {
          data: { tables: Array<{ name: string; description: string; rowCount: number; columns: Array<{ name: string; kind: string }> }> }
        }
        const rows = result.data.tables.map((table) => ({
          name: table.name,
          description: table.description,
          rowCount: table.rowCount,
          columns: table.columns.map((column) => `${column.name}:${column.kind}`).join(", "),
        }))
        printTable(rows)
        break
      }

      case "create": {
        const name = args[1]
        const colDefs = columnArgsForCreate(args).map(parseColDef)
        if (!name || colDefs.length === 0) {
          console.error("Usage: synapse create <name> <col:kind> [col:kind...] [--description \"...\"]")
          process.exit(1)
        }
        const description = getFlagValue(args, "--description")
        await apiCall(info, "createTable", { name, columns: colDefs, description })
        console.log(`Table "${name}" created.`)
        break
      }

      case "drop": {
        const name = args[1]
        if (!name) { console.error("Usage: synapse drop <name>"); process.exit(1) }
        await apiCall(info, "dropTable", { name })
        console.log(`Table "${name}" dropped.`)
        break
      }

      case "describe": {
        const name = args[1]
        if (!name) { console.error("Usage: synapse describe <name>"); process.exit(1) }
        const result = await apiCall(info, "describeTable", { name }) as { data: { columns: unknown[] } }
        printTable(result.data.columns as Record<string, unknown>[])
        break
      }

      case "update-table-description": {
        const table = args[1]
        const description = args.length >= 3 ? args.slice(2).join(" ") : undefined
        if (!table || description === undefined) {
          console.error("Usage: synapse update-table-description <table> <description>")
          process.exit(1)
        }
        await apiCall(info, "updateTableDescription", { table, description })
        console.log(`Table "${table}" description updated.`)
        break
      }

      case "add-column": {
        const table = args[1]
        const colDef = args[2]
        if (!table || !colDef) { console.error("Usage: synapse add-column <table> <col:kind> [--description \"...\"]"); process.exit(1) }
        const description = getFlagValue(args, "--description")
        const col = { ...parseColDef(colDef), description }
        await apiCall(info, "addColumn", { table, column: col })
        console.log(`Column "${col.name}" added to "${table}".`)
        break
      }

      case "update-column-description": {
        const table = args[1]
        const column = args[2]
        const description = args.length >= 4 ? args.slice(3).join(" ") : undefined
        if (!table || !column || description === undefined) {
          console.error("Usage: synapse update-column-description <table> <column> <description>")
          process.exit(1)
        }
        await apiCall(info, "updateColumnDescription", { table, column, description })
        console.log(`Column "${column}" description updated.`)
        break
      }

      case "update-column-choices": {
        const table = args[1]
        const column = args[2]
        const choicesRaw = args[3]
        if (!table || !column || !choicesRaw) {
          console.error("Usage: synapse update-column-choices <table> <column> <choice1,choice2> or '[\"choice1\",\"choice2\"]'")
          process.exit(1)
        }
        const choices = parseChoicesValue(choicesRaw)
        await apiCall(info, "updateColumnChoices", { table, column, choices })
        console.log(`Column "${column}" choices updated.`)
        break
      }

      case "choice-usage": {
        const table = args[1]
        const column = args[2]
        if (!table || !column) {
          console.error("Usage: synapse choice-usage <table> <column>")
          process.exit(1)
        }
        const result = await apiCall(info, "getColumnChoicesUsage", { table, column }) as { data: Record<string, number> }
        const rows = Object.entries(result.data).map(([choice, count]) => ({ choice, count }))
        printTable(rows)
        break
      }

      case "insert": {
        const table = args[1]
        if (!table) { console.error("Usage: synapse insert <table> --data '{...}'"); process.exit(1) }

        const batchIdx = args.indexOf("--batch")
        if (batchIdx !== -1) {
          const rows = parseDataFlag(args, "--batch")
          const result = await apiCall(info, "batchInsert", { table, rows }) as { affected: number }
          console.log(`${result.affected} rows inserted.`)
          break
        }

        if (args.indexOf("--data") === -1) { console.error("Missing --data or --batch flag"); process.exit(1) }
        const data = parseDataFlag(args)
        const result = await apiCall(info, "insert", { table, data }) as { data: { id: number } }
        console.log(`Row inserted with id=${result.data.id}.`)
        break
      }

      case "query": {
        const table = args[1]
        if (!table) { console.error("Usage: synapse query <table>"); process.exit(1) }

        const params: Record<string, unknown> = { table }
        const where = parseWhere(args)
        const limit = parseNonNegativeIntegerFlag(args, "--limit")
        const offset = parseNonNegativeIntegerFlag(args, "--offset")
        const orderBy = parseOrderBy(args)
        if (where !== undefined) params.where = where
        if (limit !== undefined) params.limit = limit
        if (offset !== undefined) params.offset = offset
        if (orderBy !== undefined) params.orderBy = orderBy

        const result = await apiCall(info, "query", params) as { data: unknown[]; total: number }
        printTable(result.data as Record<string, unknown>[])
        console.log(`\nTotal: ${result.total}`)
        break
      }

      case "count": {
        const table = args[1]
        if (!table) { console.error("Usage: synapse count <table> [--where k=v]"); process.exit(1) }

        const params: Record<string, unknown> = { table }
        const where = parseWhere(args)
        if (where !== undefined) params.where = where

        const result = await apiCall(info, "count", params) as { data: { count: number } }
        console.log(result.data.count)
        break
      }

      case "operation-log": {
        const limit = parseNonNegativeIntegerFlag(args, "--limit")
        const result = await apiCall(info, "operationLog", { limit }) as { data: Record<string, unknown>[] }
        printTable(result.data)
        break
      }

      case "rename-table": {
        const from = args[1]
        const to = args[2]
        if (!from || !to) { console.error("Usage: synapse rename-table <from> <to>"); process.exit(1) }
        await apiCall(info, "renameTable", { from, to })
        console.log(`Table "${from}" renamed to "${to}".`)
        break
      }

      case "rename-column": {
        const table = args[1]
        const from = args[2]
        const to = args[3]
        if (!table || !from || !to) { console.error("Usage: synapse rename-column <table> <from> <to>"); process.exit(1) }
        await apiCall(info, "renameColumn", { table, from, to })
        console.log(`Column "${from}" in "${table}" renamed to "${to}".`)
        break
      }

      case "drop-column": {
        const table = args[1]
        const column = args[2]
        if (!table || !column) { console.error("Usage: synapse drop-column <table> <column>"); process.exit(1) }
        await apiCall(info, "dropColumn", { table, column })
        console.log(`Column "${column}" dropped from "${table}".`)
        break
      }

      case "update": {
        const table = args[1]
        const id = Number.parseInt(args[2] ?? "", 10)
        if (!table || Number.isNaN(id) || args.indexOf("--data") === -1) {
          console.error("Usage: synapse update <table> <id> --data '{...}'")
          process.exit(1)
        }
        const data = parseDataFlag(args)
        await apiCall(info, "update", { table, id, data })
        console.log(`Row ${id} updated.`)
        break
      }

      case "update-where": {
        const table = args[1]
        const where = parseWhere(args)
        const data = args.indexOf("--data") === -1 ? undefined : parseDataFlag(args)
        const dryRun = args.includes("--dry-run")
        if (!table || where === undefined || data === undefined) {
          console.error("Usage: synapse update-where <table> --where-json '{...}' --data '{...}'")
          process.exit(1)
        }
        const result = await apiCall(info, "updateWhere", { table, where, data, dryRun }) as { affected: number }
        console.log(`${result.affected} rows ${dryRun ? "matched" : "updated"}.`)
        break
      }

      case "delete": {
        const table = args[1]
        const id = Number.parseInt(args[2] ?? "", 10)
        if (!table || Number.isNaN(id)) { console.error("Usage: synapse delete <table> <id>"); process.exit(1) }
        await apiCall(info, "delete", { table, id })
        console.log(`Row ${id} deleted.`)
        break
      }

      case "delete-where": {
        const table = args[1]
        const where = parseWhere(args)
        const dryRun = args.includes("--dry-run")
        if (!table || where === undefined) {
          console.error("Usage: synapse delete-where <table> --where-json '{...}'")
          process.exit(1)
        }
        const result = await apiCall(info, "deleteWhere", { table, where, dryRun }) as { affected: number }
        console.log(`${result.affected} rows ${dryRun ? "matched" : "deleted"}.`)
        break
      }

      case "read-sql": {
        const sql = args[1]
        if (!sql) { console.error("Usage: synapse read-sql '<SQL>' [--params '[...]']"); process.exit(1) }
        const params = parseJsonFlag(args, "--params")
        if (params !== undefined && !Array.isArray(params)) {
          console.error("Invalid --params value: expected a JSON array")
          process.exit(1)
        }
        const result = await apiCall(info, "readSQL", { sql, params }) as { data: { rows: unknown[] } }
        printTable(result.data.rows as Record<string, unknown>[])
        break
      }

      case "sql": {
        const sql = args[1]
        if (!sql) { console.error("Usage: synapse sql '<SQL>'"); process.exit(1) }
        const params = parseJsonFlag(args, "--params")
        if (params !== undefined && !Array.isArray(params)) {
          console.error("Invalid --params value: expected a JSON array")
          process.exit(1)
        }
        const result = await apiCall(info, "rawSQL", { sql, params }) as { data: { rows?: unknown[]; changes?: number } }
        if (result.data.rows) {
          printTable(result.data.rows as Record<string, unknown>[])
        } else {
          console.log(`Changes: ${result.data.changes}`)
        }
        break
      }

      default:
        break
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`)
    process.exit(1)
  }
}

void main()
