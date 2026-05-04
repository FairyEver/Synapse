export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",")
  const body = rows.map((row) =>
    columns.map((col) => escapeCsvField(String(row[col] ?? ""))).join(","),
  )
  return [header, ...body].join("\n")
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
