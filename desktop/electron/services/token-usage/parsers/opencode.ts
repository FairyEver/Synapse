import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function parseDataJson(data: string, fallbackTs: number, clientId: string): UnifiedMessage | null {
  try {
    const obj = JSON.parse(data)
    if (obj.role !== "assistant") return null

    const tokens = obj.tokens as Record<string, unknown> | undefined
    if (!tokens) return null

    const modelId = (obj.modelID as string) || ""
    if (!modelId) return null

    const cache = tokens.cache as Record<string, unknown> | undefined
    const input = Math.max(0, extractI64(tokens.input))
    const output = Math.max(0, extractI64(tokens.output))
    const cacheRead = Math.max(0, extractI64(cache?.read))
    const cacheWrite = Math.max(0, extractI64(cache?.write))
    const reasoning = Math.max(0, extractI64(tokens.reasoning))

    const time = obj.time as Record<string, unknown> | undefined
    const ts = parseTimestamp(time?.created) || fallbackTs
    const cost = Math.max(0, typeof obj.cost === "number" ? obj.cost : 0)

    const providerId = (obj.providerID as string) || inferProvider(modelId, clientId)

    return {
      client: clientId,
      modelId,
      providerId,
      sessionId: (obj.sessionID as string) || "unknown",
      timestamp: ts,
      date: timestampToLocalDate(ts),
      tokens: { input, output, cacheRead, cacheWrite, reasoning },
      cost,
      messageCount: 1,
      isTurnStart: false,
    }
  } catch { return null }
}

function inferProvider(model: string, clientId: string): string {
  const m = model.toLowerCase()
  if (m.includes("claude")) return "anthropic"
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai"
  if (m.includes("gemini")) return "google"
  if (m.includes("deepseek")) return "deepseek"
  return clientId
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
    const dedupKey = (data.id as string) || path.basename(filePath, ".json")
    const msg = parseDataJson(JSON.stringify(data), fallbackTs, clientId)
    if (msg) {
      msg.dedupKey = dedupKey
      messages.push(msg)
    }
  } catch { /* skip */ }
  return messages
}

export const opencodeParser: AgentParser = createSqliteMessageParser("opencode")
export const kiloDbParser: AgentParser = createSqliteMessageParser("kilo")
