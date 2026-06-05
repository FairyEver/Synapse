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
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  if (safeValue.includes(",") || safeValue.includes('"') || safeValue.includes("\n") || safeValue.includes("\r")) {
    return `"${safeValue.replace(/"/g, '""')}"`
  }
  return safeValue
}
