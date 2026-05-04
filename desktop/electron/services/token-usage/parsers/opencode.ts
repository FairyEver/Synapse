import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function parseDataJson(data: string, fallbackTs: number, clientId: string): UnifiedMessage | null {
  try {
    const obj = JSON.parse(data)
    if (obj.role !== "assistant") return null

    const tokens = obj.tokens as Record<string, unknown> | undefined
    if (!tokens) return null

    const cache = tokens.cache as Record<string, unknown> | undefined
    const input = extractI64(tokens.input)
    const output = extractI64(tokens.output)
    if (input + output === 0) return null

    const time = obj.time as Record<string, unknown> | undefined
    const ts = parseTimestamp(time?.created) || fallbackTs

    return {
      client: clientId,
      modelId: (obj.modelID as string) || "unknown",
      providerId: (obj.providerID as string) || "unknown",
      sessionId: (obj.sessionID as string) || "",
      timestamp: ts,
      date: timestampToLocalDate(ts),
      tokens: {
        input,
        output,
        cacheRead: extractI64(cache?.read),
        cacheWrite: extractI64(cache?.write),
        reasoning: extractI64(tokens.reasoning),
      },
      cost: typeof obj.cost === "number" ? obj.cost : 0,
      messageCount: 1,
      isTurnStart: false,
    }
  } catch { return null }
}

function createSqliteMessageParser(clientId: string): AgentParser {
  return {
    async parseFile(filePath: string): Promise<UnifiedMessage[]> {
      const messages: UnifiedMessage[] = []
      const fallbackTs = fileModifiedMs(filePath)

      if (filePath.endsWith(".json")) {
        return parseLegacyJson(filePath, fallbackTs, clientId)
      }

      try {
        const db = new DatabaseSync(filePath, { open: true, readOnly: true })
        try {
          const rows = db.prepare(`
            SELECT m.id, m.data
            FROM message m
            WHERE json_extract(m.data, '$.role') = 'assistant'
              AND json_extract(m.data, '$.tokens') IS NOT NULL
          `).all() as Record<string, unknown>[]

          for (const row of rows) {
            const msg = parseDataJson(row.data as string, fallbackTs, clientId)
            if (msg) messages.push(msg)
          }
        } finally {
          db.close()
        }
      } catch { /* skip */ }

      return messages
    },
  }
}

function parseLegacyJson(filePath: string, fallbackTs: number, clientId: string): UnifiedMessage[] {
  const messages: UnifiedMessage[] = []
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    const msg = parseDataJson(JSON.stringify(data), fallbackTs, clientId)
    if (msg) messages.push(msg)
  } catch { /* skip */ }
  return messages
}

export const opencodeParser: AgentParser = createSqliteMessageParser("opencode")
export const kiloDbParser: AgentParser = createSqliteMessageParser("kilo")
