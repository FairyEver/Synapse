import path from "node:path"

export function normalizeMarkdownTitle(title: string | null | undefined, sourcePath: string): string {
  const trimmed = title?.trim()
  return trimmed || path.basename(sourcePath)
}

export function markdownTable(rows: readonly (readonly unknown[])[]): string {
  if (rows.length === 0) return ""
  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => formatCell(row[index])))
  const header = normalized[0]
  const body = normalized.slice(1)
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
    "",
  ].join("\n")
}

export function sourceFrontmatter(input: {
  readonly sourceOriginal: string
  readonly sourceFormat: string
  readonly convertedAt: string
}): string {
  return [
    "---",
    `source_original: "${escapeYamlString(input.sourceOriginal)}"`,
    `source_format: "${escapeYamlString(input.sourceFormat)}"`,
    `converted_at: "${escapeYamlString(input.convertedAt)}"`,
    "---",
    "",
  ].join("\n")
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim()
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}
