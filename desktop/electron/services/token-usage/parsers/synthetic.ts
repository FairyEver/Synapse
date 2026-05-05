import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import type { AgentParser, UnifiedMessage } from "./types"
import { timestampToLocalDate } from "./utils"

export function isSyntheticModel(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return lower.startsWith("hf:") || lower.startsWith("accounts/fireworks/") || lower.startsWith("accounts/together/")
}

export function isSyntheticProvider(providerId: string): boolean {
  const lower = providerId.toLowerCase()
  return lower === "synthetic" || lower === "glhf" || lower === "synthetic.new" || lower === "octofriend"
}

export function isSyntheticGateway(modelId: string, providerId: string): boolean {
  return isSyntheticModel(modelId) || isSyntheticProvider(providerId)
}

export function normalizeSyntheticModel(modelId: string): string {
  const lower = modelId.toLowerCase()
  if (lower.startsWith("hf:")) {
    const rest = lower.slice(3)
    const slashIdx = rest.indexOf("/")
    return slashIdx >= 0 ? rest.slice(slashIdx + 1) : rest
  }
  if (lower.startsWith("accounts/")) {
    const modelsIdx = lower.indexOf("/models/")
    if (modelsIdx >= 0) return lower.slice(modelsIdx + 8)
  }
  return lower
}

export const syntheticParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    if (!fs.existsSync(filePath)) return []
    try {
      const db = new DatabaseSync(filePath, { open: true, readOnly: true })
      const messages = parseMessagesTable(db) || parseTokenUsageTable(db)
      db.close()
      return messages || []
    } catch { return [] }
  },
}

function hasTable(db: DatabaseSync, ...names: string[]): boolean {
  const placeholders = names.map(() => "?").join(",")
  const stmt = db.prepare(`SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`)
  const row = stmt.get(...names) as { cnt: number } | undefined
  return (row?.cnt ?? 0) > 0
}

function parseMessagesTable(db: DatabaseSync): UnifiedMessage[] | null {
  if (!hasTable(db, "messages")) return null
  try {
    const stmt = db.prepare(
      "SELECT id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, cost, timestamp, session_id, provider FROM messages WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL"
    )
    const rows = stmt.all() as { id: string; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; reasoning_tokens: number; cost: number; timestamp: number; session_id: string; provider: string }[]
    const messages: UnifiedMessage[] = []
    for (const row of rows) {
      const input = Math.max(0, row.input_tokens || 0)
      const output = Math.max(0, row.output_tokens || 0)
      const cacheRead = Math.max(0, row.cache_read_tokens || 0)
      const cacheWrite = Math.max(0, row.cache_write_tokens || 0)
      const reasoning = Math.max(0, row.reasoning_tokens || 0)
      if (input + output + cacheRead + cacheWrite + reasoning === 0) continue
      const ts = row.timestamp > 1e12 ? row.timestamp : row.timestamp * 1000
      const rowId = String(row.id || "")
      messages.push({
        client: "synthetic",
        modelId: normalizeSyntheticModel(row.model || ""),
        providerId: row.provider || "synthetic",
        sessionId: row.session_id || "unknown",
        timestamp: ts,
        date: timestampToLocalDate(ts),
        tokens: { input, output, cacheRead, cacheWrite, reasoning },
        cost: Math.max(0, row.cost || 0),
        dedupKey: rowId || undefined,
        messageCount: 1,
        isTurnStart: false,
      })
    }
    return messages.length > 0 ? messages : null
  } catch { return null }
}

function parseTokenUsageTable(db: DatabaseSync): UnifiedMessage[] | null {
  if (!hasTable(db, "token_usage")) return null
  try {
    const stmt = db.prepare(
      "SELECT id, model, input_tokens, output_tokens, timestamp, session_id FROM token_usage WHERE input_tokens > 0 OR output_tokens > 0"
    )
    const rows = stmt.all() as { id: string; model: string; input_tokens: number; output_tokens: number; timestamp: number; session_id: string }[]
    const messages: UnifiedMessage[] = []
    for (const row of rows) {
      const ts = row.timestamp > 1e12 ? row.timestamp : row.timestamp * 1000
      const rowId = String(row.id || "")
      messages.push({
        client: "synthetic",
        modelId: normalizeSyntheticModel(row.model || ""),
        providerId: "synthetic",
        sessionId: row.session_id || "unknown",
        timestamp: ts,
        date: timestampToLocalDate(ts),
        tokens: { input: Math.max(0, row.input_tokens || 0), output: Math.max(0, row.output_tokens || 0), cacheRead: 0, cacheWrite: 0, reasoning: 0 },
        cost: 0,
        dedupKey: rowId || undefined,
        messageCount: 1,
        isTurnStart: false,
      })
    }
    return messages.length > 0 ? messages : null
  } catch { return null }
}
