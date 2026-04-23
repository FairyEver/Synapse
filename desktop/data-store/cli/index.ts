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

function parseColDef(s: string): { name: string; type: string } {
  const [name, type] = s.split(":")
  if (!name || !type) {
    console.error(`Invalid column definition: "${s}". Expected format: name:type`)
    process.exit(1)
  }
  return { name, type: type.toUpperCase() }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === "help" || command === "--help") {
    console.log(`synapse - Synapse Data Store CLI

Usage:
  synapse tables                                     List all tables
  synapse create <name> <col:type> [col:type...]     Create a table
  synapse drop <name>                                Drop a table
  synapse describe <name>                            Describe table schema
  synapse add-column <table> <col:type>              Add a column
  synapse insert <table> --data '{"k":"v"}'          Insert a row
  synapse insert <table> --batch '[{...}]'           Batch insert
  synapse query <table> [--where k=v] [--limit N]    Query rows
  synapse update <table> <id> --data '{"k":"v"}'     Update a row
  synapse delete <table> <id>                        Delete a row
  synapse sql '<SQL>'                                Execute raw SQL
  synapse status                                     Show service status`)
    return
  }

  const KNOWN_COMMANDS = new Set(["tables", "create", "drop", "describe", "add-column", "insert", "query", "update", "delete", "sql", "status"])
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
          console.error("Usage: synapse create <name> <col:type> [col:type...]")
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
        if (!table || !colDef) { console.error("Usage: synapse add-column <table> <col:type>"); process.exit(1) }
        const col = parseColDef(colDef)
        await apiCall(info, "addColumn", { table, column: col })
        console.log(`Column "${col.name}" added to "${table}".`)
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
