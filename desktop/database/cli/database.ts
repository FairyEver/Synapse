type CliApiCall = (action: string, params?: Record<string, unknown>) => Promise<unknown>
type PrintLine = (line: string) => void

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

function formatValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function printTable(rows: Record<string, unknown>[], print: PrintLine): void {
  if (rows.length === 0) {
    print("(no rows)")
    return
  }

  const keys = Object.keys(rows[0])
  const widths = keys.map((key) => Math.max(key.length, ...rows.map((row) => formatValue(row[key]).length)))
  print(keys.map((key, index) => key.padEnd(widths[index])).join("  "))
  print(widths.map((width) => "-".repeat(width)).join("--"))
  for (const row of rows) {
    print(keys.map((key, index) => formatValue(row[key]).padEnd(widths[index])).join("  "))
  }
}

function fail(message: string): never {
  throw new Error(message)
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    fail(`Invalid JSON for ${label}.`)
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith("--")) fail(`Missing value for ${flag}`)
  return value
}

function parseJsonFlag(args: string[], flag: string): unknown | undefined {
  const value = getFlagValue(args, flag)
  return value === undefined ? undefined : parseJsonValue(value, flag)
}

function parseWherePairs(args: string[]): Record<string, string> | undefined {
  const whereIndex = args.indexOf("--where")
  if (whereIndex === -1) return undefined

  const where: Record<string, string> = {}
  for (let index = whereIndex + 1; index < args.length; index++) {
    if (args[index].startsWith("--")) break
    const eqIndex = args[index].indexOf("=")
    if (eqIndex === -1) fail(`Invalid --where value: "${args[index]}". Expected format: key=value`)
    const key = args[index].slice(0, eqIndex)
    const value = args[index].slice(eqIndex + 1)
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
    fail(`Invalid ${flag} value: expected a non-negative integer`)
  }
  return parsed
}

function parseOrderBy(args: string[]): string | { field: string; dir: "asc" | "desc" } | undefined {
  const field = getFlagValue(args, "--order-by")
  if (field === undefined) return undefined
  const dir = getFlagValue(args, "--order-dir")
  if (dir === undefined) return field
  if (dir !== "asc" && dir !== "desc") fail("Invalid --order-dir value: expected asc or desc")
  return { field, dir }
}

function parseDataFlag(args: string[], flag = "--data"): unknown {
  const value = getFlagValue(args, flag)
  if (value === undefined) fail(`Missing ${flag}`)
  return parseJsonValue(value, flag)
}

function parseChoicesValue(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith("[")) {
    const parsed = parseJsonValue(trimmed, "choices")
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      fail("Invalid choices value: expected a JSON array of strings")
    }
    return parsed
  }
  const choices = value.split(",").map((item) => item.trim()).filter(Boolean)
  if (choices.length === 0) fail("Invalid choices value: expected at least one choice")
  return choices
}

function parseColDef(value: string): { name: string; kind: string; choices?: string[] } {
  const parts = value.split(":")
  const [name, kind, choicesRaw] = parts
  if (!name || !kind || parts.length > 3) {
    fail(`Invalid column definition: "${value}". Expected format: name:kind or name:kind:v1,v2,v3`)
  }
  if (!COLUMN_KINDS.has(kind)) {
    const replacement = OLD_KIND_HINTS[kind.toUpperCase()]
    fail(replacement
      ? `Unsupported column kind "${kind}". Use "${replacement}" instead.`
      : `Unsupported column kind "${kind}". Use one of: ${Array.from(COLUMN_KINDS).join(", ")}`)
  }
  const isChoiceKind = kind === "single_choice" || kind === "multi_choice"
  const choices = choicesRaw?.split(",").map((item) => item.trim()).filter(Boolean)
  if (isChoiceKind && (!choices || choices.length === 0)) {
    fail(`Column "${name}" with kind "${kind}" requires choices: ${name}:${kind}:v1,v2,v3`)
  }
  if (!isChoiceKind && choicesRaw !== undefined) {
    fail(`Column "${name}" has choices but kind "${kind}" does not use choices.`)
  }
  return choices ? { name, kind, choices } : { name, kind }
}

function columnArgsForTableCreate(args: string[]): string[] {
  const flagIndex = args.findIndex((item, index) => index >= 3 && item.startsWith("--"))
  return flagIndex === -1 ? args.slice(3) : args.slice(3, flagIndex)
}

function tableNameArg(args: string[], usage: string): string {
  return args[2] || fail(usage)
}

function columnNameArg(args: string[], usage: string): string {
  return args[3] || fail(usage)
}

function rowIdArg(args: string[], usage: string): number {
  const rowId = Number.parseInt(args[3] ?? "", 10)
  if (Number.isNaN(rowId)) fail(usage)
  return rowId
}

function queryParams(tableName: string, args: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = { tableName }
  const where = parseWhere(args)
  const limit = parseNonNegativeIntegerFlag(args, "--limit")
  const offset = parseNonNegativeIntegerFlag(args, "--offset")
  const orderBy = parseOrderBy(args)
  if (where !== undefined) params.where = where
  if (limit !== undefined) params.limit = limit
  if (offset !== undefined) params.offset = offset
  if (orderBy !== undefined) params.orderBy = orderBy
  return params
}

export async function handleDatabaseCommand(
  args: string[],
  apiCall: CliApiCall,
  print: PrintLine = console.log,
): Promise<void> {
  const command = `${args[0] ?? ""}.${args[1] ?? ""}`

  switch (command) {
    case "table.list": {
      const result = await apiCall("database.table.list", {}) as { data: unknown[] }
      printTable(result.data as Record<string, unknown>[], print)
      break
    }

    case "overview.get": {
      const result = await apiCall("database.overview.get", {}) as {
        data: { tables: Array<{ name: string; description: string; rowCount: number; columns: Array<{ name: string; kind: string }> }> }
      }
      printTable(result.data.tables.map((table) => ({
        name: table.name,
        description: table.description,
        rowCount: table.rowCount,
        columns: table.columns.map((column) => `${column.name}:${column.kind}`).join(", "),
      })), print)
      break
    }

    case "table.create": {
      const tableName = tableNameArg(args, "Usage: synapse database table create <tableName> <col:kind> [...] [--description \"...\"]")
      const columns = columnArgsForTableCreate(args).map(parseColDef)
      if (columns.length === 0) fail("Usage: synapse database table create <tableName> <col:kind> [...] [--description \"...\"]")
      await apiCall("database.table.create", { tableName, columns, description: getFlagValue(args, "--description") })
      print(`Table "${tableName}" created.`)
      break
    }

    case "table.delete": {
      const tableName = tableNameArg(args, "Usage: synapse database table delete <tableName>")
      await apiCall("database.table.delete", { tableName })
      print(`Table "${tableName}" deleted.`)
      break
    }

    case "table.describe": {
      const tableName = tableNameArg(args, "Usage: synapse database table describe <tableName>")
      const result = await apiCall("database.table.describe", { tableName }) as { data: { columns: unknown[] } }
      printTable(result.data.columns as Record<string, unknown>[], print)
      break
    }

    case "table.update": {
      const tableName = tableNameArg(args, "Usage: synapse database table update <tableName> <description>")
      const description = args.length >= 4 ? args.slice(3).join(" ") : undefined
      if (description === undefined) fail("Usage: synapse database table update <tableName> <description>")
      await apiCall("database.table.update", { tableName, description })
      print(`Table "${tableName}" updated.`)
      break
    }

    case "table.rename": {
      const fromTableName = tableNameArg(args, "Usage: synapse database table rename <fromTableName> <toTableName>")
      const toTableName = columnNameArg(args, "Usage: synapse database table rename <fromTableName> <toTableName>")
      await apiCall("database.table.rename", { fromTableName, toTableName })
      print(`Table "${fromTableName}" renamed to "${toTableName}".`)
      break
    }

    case "column.create": {
      const tableName = tableNameArg(args, "Usage: synapse database column create <tableName> <col:kind> [--description \"...\"]")
      const colDef = columnNameArg(args, "Usage: synapse database column create <tableName> <col:kind> [--description \"...\"]")
      const column = { ...parseColDef(colDef), description: getFlagValue(args, "--description") }
      await apiCall("database.column.create", { tableName, column })
      print(`Column "${column.name}" added to "${tableName}".`)
      break
    }

    case "column.update": {
      const tableName = tableNameArg(args, "Usage: synapse database column update <tableName> <columnName> <description>")
      const columnName = columnNameArg(args, "Usage: synapse database column update <tableName> <columnName> <description>")
      const description = args.length >= 5 ? args.slice(4).join(" ") : undefined
      if (description === undefined) fail("Usage: synapse database column update <tableName> <columnName> <description>")
      await apiCall("database.column.update", { tableName, columnName, description })
      print(`Column "${columnName}" updated.`)
      break
    }

    case "column.rename": {
      const tableName = tableNameArg(args, "Usage: synapse database column rename <tableName> <fromColumnName> <toColumnName>")
      const fromColumnName = columnNameArg(args, "Usage: synapse database column rename <tableName> <fromColumnName> <toColumnName>")
      const toColumnName = args[4] || fail("Usage: synapse database column rename <tableName> <fromColumnName> <toColumnName>")
      await apiCall("database.column.rename", { tableName, fromColumnName, toColumnName })
      print(`Column "${fromColumnName}" in "${tableName}" renamed to "${toColumnName}".`)
      break
    }

    case "column.delete": {
      const tableName = tableNameArg(args, "Usage: synapse database column delete <tableName> <columnName>")
      const columnName = columnNameArg(args, "Usage: synapse database column delete <tableName> <columnName>")
      await apiCall("database.column.delete", { tableName, columnName })
      print(`Column "${columnName}" deleted from "${tableName}".`)
      break
    }

    case "choice.update": {
      const tableName = tableNameArg(args, "Usage: synapse database choice update <tableName> <columnName> <choices>")
      const columnName = columnNameArg(args, "Usage: synapse database choice update <tableName> <columnName> <choices>")
      const choicesRaw = args[4] || fail("Usage: synapse database choice update <tableName> <columnName> <choices>")
      await apiCall("database.choice.update", { tableName, columnName, choices: parseChoicesValue(choicesRaw) })
      print(`Column "${columnName}" choices updated.`)
      break
    }

    case "choice-usage.get": {
      const tableName = tableNameArg(args, "Usage: synapse database choice-usage get <tableName> <columnName>")
      const columnName = columnNameArg(args, "Usage: synapse database choice-usage get <tableName> <columnName>")
      const result = await apiCall("database.choice_usage.get", { tableName, columnName }) as { data: Record<string, number> }
      printTable(Object.entries(result.data).map(([choice, count]) => ({ choice, count })), print)
      break
    }

    case "row.create": {
      const tableName = tableNameArg(args, "Usage: synapse database row create <tableName> --data '{...}'")
      const result = await apiCall("database.row.create", { tableName, data: parseDataFlag(args) }) as { data: { id: number } }
      print(`Row created with id=${result.data.id}.`)
      break
    }

    case "rows.create": {
      const tableName = tableNameArg(args, "Usage: synapse database rows create <tableName> --data '[{...}]'")
      const rows = parseDataFlag(args)
      const result = await apiCall("database.rows.create", { tableName, rows }) as { affected: number }
      print(`${result.affected} rows created.`)
      break
    }

    case "row.list": {
      const tableName = tableNameArg(args, "Usage: synapse database row list <tableName>")
      const result = await apiCall("database.row.list", queryParams(tableName, args)) as { data: unknown[]; total: number }
      printTable(result.data as Record<string, unknown>[], print)
      print(`\nTotal: ${result.total}`)
      break
    }

    case "row.count": {
      const tableName = tableNameArg(args, "Usage: synapse database row count <tableName>")
      const result = await apiCall("database.row.count", queryParams(tableName, args)) as { data: { count: number } }
      print(String(result.data.count))
      break
    }

    case "row.update": {
      const tableName = tableNameArg(args, "Usage: synapse database row update <tableName> <rowId> --data '{...}'")
      const rowId = rowIdArg(args, "Usage: synapse database row update <tableName> <rowId> --data '{...}'")
      await apiCall("database.row.update", { tableName, rowId, data: parseDataFlag(args) })
      print(`Row ${rowId} updated.`)
      break
    }

    case "row.delete": {
      const tableName = tableNameArg(args, "Usage: synapse database row delete <tableName> <rowId>")
      const rowId = rowIdArg(args, "Usage: synapse database row delete <tableName> <rowId>")
      await apiCall("database.row.delete", { tableName, rowId })
      print(`Row ${rowId} deleted.`)
      break
    }

    case "rows.update": {
      const tableName = tableNameArg(args, "Usage: synapse database rows update <tableName> --where-json '{...}' --data '{...}'")
      const where = parseWhere(args)
      const data = args.includes("--data") ? parseDataFlag(args) : undefined
      const dryRun = args.includes("--dry-run")
      if (where === undefined || data === undefined) fail("Usage: synapse database rows update <tableName> --where-json '{...}' --data '{...}'")
      const result = await apiCall("database.rows.update", { tableName, where, data, dryRun }) as { affected: number }
      print(`${result.affected} rows ${dryRun ? "matched" : "updated"}.`)
      break
    }

    case "rows.delete": {
      const tableName = tableNameArg(args, "Usage: synapse database rows delete <tableName> --where-json '{...}'")
      const where = parseWhere(args)
      const dryRun = args.includes("--dry-run")
      if (where === undefined) fail("Usage: synapse database rows delete <tableName> --where-json '{...}'")
      const result = await apiCall("database.rows.delete", { tableName, where, dryRun }) as { affected: number }
      print(`${result.affected} rows ${dryRun ? "matched" : "deleted"}.`)
      break
    }

    case "log.list": {
      const limit = parseNonNegativeIntegerFlag(args, "--limit")
      const result = await apiCall("database.log.list", { limit }) as { data: Record<string, unknown>[] }
      printTable(result.data, print)
      break
    }

    case "sql.read": {
      const sql = args[2] || fail("Usage: synapse database sql read '<SQL>' [--params '[...]']")
      const params = parseJsonFlag(args, "--params")
      if (params !== undefined && !Array.isArray(params)) fail("Invalid --params value: expected a JSON array")
      const result = await apiCall("database.sql.read", { sql, params }) as { data: { rows: unknown[] } }
      printTable(result.data.rows as Record<string, unknown>[], print)
      break
    }

    case "sql.execute": {
      const sql = args[2] || fail("Usage: synapse database sql execute '<SQL>' [--params '[...]']")
      const params = parseJsonFlag(args, "--params")
      if (params !== undefined && !Array.isArray(params)) fail("Invalid --params value: expected a JSON array")
      const result = await apiCall("database.sql.execute", { sql, params }) as { data: { rows?: unknown[]; changes?: number } }
      if (result.data.rows) {
        printTable(result.data.rows as Record<string, unknown>[], print)
      } else {
        print(`Changes: ${result.data.changes}`)
      }
      break
    }

    default:
      throw new Error(`Unknown database command: ${args.join(" ")}\nRun "synapse help" for usage.`)
  }
}
