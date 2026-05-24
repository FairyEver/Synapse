export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",")
  const body = rows.map((row) =>
    columns.map((col) => escapeCsvField(formatCsvValue(row[col]))).join(","),
  )
  return `\uFEFF${[header, ...body].join("\n")}`
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
