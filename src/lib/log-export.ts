import type { SynapseLogEntry } from "../types/log"

function formatLogEntryForExport(entry: SynapseLogEntry): string {
  const head = `[${entry.createdAt}] [${entry.level.toUpperCase()}] [${entry.source}:${entry.category}] ${entry.message}`

  if (!entry.details) {
    return head
  }

  return `${head}\n${entry.details}`
}

function formatLogExportText(entries: SynapseLogEntry[]): string {
  const content = entries.map(formatLogEntryForExport).join("\n\n")

  return content.length > 0 ? `${content}\n` : ""
}

export { formatLogEntryForExport, formatLogExportText }
