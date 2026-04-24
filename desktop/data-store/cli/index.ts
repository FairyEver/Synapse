#!/usr/bin/env node

const [major] = process.versions.node.split(".").map(Number)
if (major < 18) {
  console.error(`Error: synapse requires Node.js >= 18.0.0 (current: ${process.versions.node})`)
  process.exit(1)
}

import { apiCall, isAppRunning, readServerInfo, type ServerInfo } from "../shared/resolve-user-data"

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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === "help" || command === "--help") {
    console.log(`synapse - Synapse Data Store CLI

Usage:
  synapse tables                                     List all tables
  synapse create <name> <col:kind> [col:kind...]     Create a table
  synapse drop <name>                                Drop a table
  synapse describe <name>                            Describe table schema
  synapse add-column <table> <col:kind>              Add a column
  synapse drop-column <table> <column>               Drop a column
  synapse rename-table <from> <to>                   Rename a table
  synapse rename-column <table> <from> <to>          Rename a column
  synapse update-column-description <table> <col> <desc>  Update column description
  synapse insert <table> --data '{"k":"v"}'          Insert a row
  synapse insert <table> --batch '[{...}]'           Batch insert
  synapse query <table> [--where k=v] [--limit N]    Query rows
  synapse count <table> [--where k=v]                Count rows
  synapse update <table> <id> --data '{"k":"v"}'     Update a row
  synapse delete <table> <id>                        Delete a row
  synapse sql '<SQL>'                                Execute raw SQL
  synapse status                                     Show service status

Column kinds:
  text, integer, decimal, boolean, date, timestamp,
  single_choice, multi_choice, json, binary

Choice columns:
  synapse create todo title:text priority:single_choice:high,medium,low tags:multi_choice:work,study,home done:boolean due:date`)
    return
  }

  const KNOWN_COMMANDS = new Set(["tables", "create", "drop", "describe", "add-column", "drop-column", "rename-table", "rename-column", "update-column-description", "insert", "query", "count", "update", "delete", "sql", "status"])
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

      case "create": {
        const name = args[1]
        const colDefs = args.slice(2).map(parseColDef)
        if (!name || colDefs.length === 0) {
          console.error("Usage: synapse create <name> <col:kind> [col:kind...]")
          process.exit(1)
        }
        await apiCall(info, "createTable", { name, columns: colDefs })
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

      case "add-column": {
        const table = args[1]
        const colDef = args[2]
        if (!table || !colDef) { console.error("Usage: synapse add-column <table> <col:kind>"); process.exit(1) }
        const col = parseColDef(colDef)
        await apiCall(info, "addColumn", { table, column: col })
        console.log(`Column "${col.name}" added to "${table}".`)
        break
      }

      case "update-column-description": {
        const table = args[1]
        const column = args[2]
        const description = args[3]
        if (!table || !column || !description) {
          console.error("Usage: synapse update-column-description <table> <column> <description>")
          process.exit(1)
        }
        await apiCall(info, "updateColumnDescription", { table, column, description })
        console.log(`Column "${column}" description updated.`)
        break
      }

      case "insert": {
        const table = args[1]
        if (!table) { console.error("Usage: synapse insert <table> --data '{...}'"); process.exit(1) }

        const batchIdx = args.indexOf("--batch")
        if (batchIdx !== -1) {
          let rows: unknown
          try { rows = JSON.parse(args[batchIdx + 1]) } catch {
            console.error("Invalid JSON for --batch. Expected a JSON array of objects.")
            process.exit(1)
          }
          const result = await apiCall(info, "batchInsert", { table, rows }) as { affected: number }
          console.log(`${result.affected} rows inserted.`)
          break
        }

        const dataIdx = args.indexOf("--data")
        if (dataIdx === -1) { console.error("Missing --data or --batch flag"); process.exit(1) }
        let data: unknown
        try { data = JSON.parse(args[dataIdx + 1]) } catch {
          console.error("Invalid JSON for --data. Expected a JSON object.")
          process.exit(1)
        }
        const result = await apiCall(info, "insert", { table, data }) as { data: { id: number } }
        console.log(`Row inserted with id=${result.data.id}.`)
        break
      }

      case "query": {
        const table = args[1]
        if (!table) { console.error("Usage: synapse query <table>"); process.exit(1) }

        const params: Record<string, unknown> = { table }
        const whereIdx = args.indexOf("--where")
        if (whereIdx !== -1) {
          const where: Record<string, string> = {}
          for (let i = whereIdx + 1; i < args.length; i++) {
            if (args[i].startsWith("--")) break
            const eqIdx = args[i].indexOf("=")
            if (eqIdx === -1) {
              console.error(`Invalid --where value: "${args[i]}". Expected format: key=value`)
              process.exit(1)
            }
            const k = args[i].slice(0, eqIdx)
            const v = args[i].slice(eqIdx + 1)
            if (k) where[k] = v
          }
          params.where = where
        }
        const limitIdx = args.indexOf("--limit")
        if (limitIdx !== -1) {
          const limitVal = parseInt(args[limitIdx + 1])
          if (isNaN(limitVal) || limitVal < 0 || !Number.isInteger(limitVal)) {
            console.error("Invalid --limit value: expected a non-negative integer")
            process.exit(1)
          }
          params.limit = limitVal
        }

        const result = await apiCall(info, "query", params) as { data: unknown[]; total: number }
        printTable(result.data as Record<string, unknown>[])
        console.log(`\nTotal: ${result.total}`)
        break
      }

      case "count": {
        const table = args[1]
        if (!table) { console.error("Usage: synapse count <table> [--where k=v]"); process.exit(1) }

        const params: Record<string, unknown> = { table }
        const whereIdx = args.indexOf("--where")
        if (whereIdx !== -1) {
          const where: Record<string, string> = {}
          for (let i = whereIdx + 1; i < args.length; i++) {
            if (args[i].startsWith("--")) break
            const eqIdx = args[i].indexOf("=")
            if (eqIdx === -1) {
              console.error(`Invalid --where value: "${args[i]}". Expected format: key=value`)
              process.exit(1)
            }
            const k = args[i].slice(0, eqIdx)
            const v = args[i].slice(eqIdx + 1)
            if (k) where[k] = v
          }
          params.where = where
        }

        const result = await apiCall(info, "count", params) as { data: { count: number } }
        console.log(result.data.count)
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
        const id = parseInt(args[2])
        const dataIdx = args.indexOf("--data")
        if (!table || isNaN(id) || dataIdx === -1) {
          console.error("Usage: synapse update <table> <id> --data '{...}'")
          process.exit(1)
        }
        let data: unknown
        try { data = JSON.parse(args[dataIdx + 1]) } catch {
          console.error("Invalid JSON for --data. Expected a JSON object.")
          process.exit(1)
        }
        await apiCall(info, "update", { table, id, data })
        console.log(`Row ${id} updated.`)
        break
      }

      case "delete": {
        const table = args[1]
        const id = parseInt(args[2])
        if (!table || isNaN(id)) { console.error("Usage: synapse delete <table> <id>"); process.exit(1) }
        await apiCall(info, "delete", { table, id })
        console.log(`Row ${id} deleted.`)
        break
      }

      case "sql": {
        const sql = args[1]
        if (!sql) { console.error("Usage: synapse sql '<SQL>'"); process.exit(1) }
        const result = await apiCall(info, "rawSQL", { sql }) as { data: { rows?: unknown[]; changes?: number } }
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
