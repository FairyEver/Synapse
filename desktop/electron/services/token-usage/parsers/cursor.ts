import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, inferProvider, timestampToLocalDate } from "./utils"

type CsvFormat = "v1" | "v2" | "v3"

function detectFormat(header: string): CsvFormat {
  if (header.includes("Cloud Agent ID")) return "v3"
  if (header.includes("Kind")) return "v2"
  return "v1"
}

function colIndex(format: CsvFormat) {
  switch (format) {
    case "v1": return { model: 1, inputCW: 2, inputNoCW: 3, cacheRead: 4, output: 5, cost: 7 }
    case "v2": return { model: 2, inputCW: 4, inputNoCW: 5, cacheRead: 6, output: 7, cost: 9 }
    case "v3": return { model: 4, inputCW: 6, inputNoCW: 7, cacheRead: 8, output: 9, cost: 11 }
  }
}

function parseCsvCost(raw: string): number {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "")
  if (!s || s.toLowerCase() === "nan" || s === "Included" || s === "-") return 0
  const n = parseFloat(s)
  return Number.isNaN(n) ? 0 : n
}

function parseCsvDate(raw: string): number {
  const trimmed = raw.trim()
  // Date-only strings (e.g. "2025-02-05") → noon UTC to avoid timezone drift
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed + "T12:00:00Z")
    return Number.isNaN(d.getTime()) ? 0 : d.getTime()
  }
  const d = new Date(trimmed)
  if (!Number.isNaN(d.getTime())) return d.getTime()
  return 0
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (ch === "," && !inQuotes) { fields.push(current); current = ""; continue }
    current += ch
  }
  fields.push(current)
  return fields
}

export const cursorParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []

    const basename = path.basename(filePath)
    let accountId: string
    if (basename === "usage.csv") {
      accountId = "active"
    } else {
      const accountMatch = basename.match(/^usage\.(.+)\.csv$/)
      accountId = accountMatch ? accountMatch[1] : "unknown"
    }

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    let format: CsvFormat | null = null
    let cols: ReturnType<typeof colIndex> | null = null

    for await (const line of rl) {
      if (!format) {
        if (!line.includes("Date") || !line.includes("Model")) return messages
        format = detectFormat(line)
        cols = colIndex(format)
        continue
      }
      if (!cols) continue

      const fields = parseCsvLine(line)
      if (fields.length <= cols.cost) continue

      const dateStr = fields[0]?.trim()
      if (!dateStr) continue

      const model = fields[cols.model]?.trim() || ""
      if (!model) continue

      const inputWithCW = Math.max(0, extractI64(fields[cols.inputCW]?.trim()))
      const inputNoCW = Math.max(0, extractI64(fields[cols.inputNoCW]?.trim()))
      const cacheRead = Math.max(0, extractI64(fields[cols.cacheRead]?.trim()))
      const output = Math.max(0, extractI64(fields[cols.output]?.trim()))
      const cost = Math.max(0, parseCsvCost(fields[cols.cost] || ""))

      const input = inputNoCW
      const cacheWrite = inputWithCW > inputNoCW ? inputWithCW - inputNoCW : 0

      if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) continue

      const ts = parseCsvDate(dateStr)
      if (ts === 0) continue

      messages.push({
        client: "cursor",
        modelId: model,
        providerId: inferProvider(model, "cursor"),
        sessionId: `cursor-${accountId}-${dateStr}`,
        timestamp: ts,
        date: timestampToLocalDate(ts),
        tokens: {
          input,
          output,
          cacheRead,
          cacheWrite,
          reasoning: 0,
        },
        cost,
        messageCount: 1,
        isTurnStart: false,
      })
    }

    return messages
  },
}
