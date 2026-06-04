export interface ParsedCsv {
  readonly rows: readonly (readonly string[])[]
  readonly truncated: boolean
}

export function parseCsv(input: string, options: { readonly delimiter: string; readonly maxRows: number }): ParsedCsv {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\""
        index += 1
      } else if (char === "\"") {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === "\"") {
      quoted = true
      continue
    }
    if (char === options.delimiter) {
      row.push(cell)
      cell = ""
      continue
    }
    if (char === "\n") {
      row.push(cell.replace(/\r$/, ""))
      rows.push(row)
      if (rows.length >= options.maxRows) {
        return { rows, truncated: true }
      }
      row = []
      cell = ""
      continue
    }
    cell += char
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ""))
    rows.push(row)
  }

  return { rows, truncated: false }
}

export function csvRowsToMarkdown(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return ""
  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => escapeCell(row[index] ?? "")))
  const header = normalized[0]
  const body = normalized.slice(1)
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n")
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim()
}

