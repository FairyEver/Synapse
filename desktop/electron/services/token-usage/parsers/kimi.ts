import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, fileModifiedMs, timestampToLocalDate } from "./utils"

function readModelFromConfig(wirePath: string): string {
  try {
    const sessionsDir = path.dirname(path.dirname(path.dirname(wirePath)))
    const kimiDir = path.dirname(sessionsDir)
    const configPath = path.join(kimiDir, "config.json")
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    const model = content?.model as string | undefined
    if (model && model.trim()) return model.trim()
  } catch { /* no config */ }
  return "kimi-for-coding"
}

function extractSessionId(wirePath: string): string {
  return path.basename(path.dirname(wirePath)) || "unknown"
}

export const kimiParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)
    const model = readModelFromConfig(filePath)
    const sessionId = extractSessionId(filePath)

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>

        if ((obj.type as string) === "metadata") continue

        const message = obj.message as Record<string, unknown> | undefined
        if (!message) continue
        if ((message.type as string) !== "StatusUpdate") continue

        const payload = message.payload as Record<string, unknown> | undefined
        if (!payload) continue

        const tokenUsage = payload.token_usage as Record<string, unknown> | undefined
        if (!tokenUsage) continue

        const input = Math.max(0, extractI64(tokenUsage.input_other))
        const output = Math.max(0, extractI64(tokenUsage.output))
        const cacheRead = Math.max(0, extractI64(tokenUsage.input_cache_read))
        const cacheWrite = Math.max(0, extractI64(tokenUsage.input_cache_creation))

        if (input + output + cacheRead + cacheWrite === 0) continue

        const ts = typeof obj.timestamp === "number"
          ? Math.floor((obj.timestamp as number) * 1000)
          : fallbackTs

        const dedupKey = (payload.message_id as string) || undefined

        messages.push({
          client: "kimi",
          modelId: model,
          providerId: "moonshot",
          sessionId,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: { input, output, cacheRead, cacheWrite, reasoning: 0 },
          cost: 0,
          messageCount: 1,
          dedupKey,
          isTurnStart: false,
        })
      } catch { /* skip malformed lines */ }
    }

    return messages
  },
}
