import fs from "node:fs"
import readline from "node:readline"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

interface GenericJsonlConfig {
  clientId: string
  providerId: string
  lineFilter?: string
  extractModel: (obj: Record<string, unknown>) => string
  extractUsage: (obj: Record<string, unknown>) => {
    input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number
  } | null
  extractTimestamp: (obj: Record<string, unknown>) => unknown
  extractSessionId?: (obj: Record<string, unknown>) => string
}

export function createGenericJsonlParser(config: GenericJsonlConfig): AgentParser {
  return {
    async parseFile(filePath: string): Promise<UnifiedMessage[]> {
      const messages: UnifiedMessage[] = []
      const fallbackTs = fileModifiedMs(filePath)

      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
      })

      for await (const line of rl) {
        if (config.lineFilter && !line.includes(config.lineFilter)) continue
        try {
          const obj = JSON.parse(line)
          const usage = config.extractUsage(obj)
          if (!usage) continue
          if (usage.input + usage.output === 0) continue

          const ts = parseTimestamp(config.extractTimestamp(obj)) || fallbackTs
          messages.push({
            client: config.clientId,
            modelId: config.extractModel(obj) || "unknown",
            providerId: config.providerId,
            sessionId: config.extractSessionId?.(obj) || "",
            timestamp: ts,
            date: timestampToLocalDate(ts),
            tokens: usage,
            cost: 0,
            messageCount: 1,
            isTurnStart: false,
          })
        } catch {
          // skip malformed lines
        }
      }

      return messages
    },
  }
}
