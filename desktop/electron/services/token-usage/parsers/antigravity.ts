import fs from "node:fs"
import readline from "node:readline"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, timestampToLocalDate } from "./utils"

function inferProvider(model: string): string {
  const m = model.toLowerCase()
  if (m.includes("claude") || m.includes("anthropic")) return "anthropic"
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai"
  if (m.includes("gemini")) return "google"
  if (m.includes("deepseek")) return "deepseek"
  return "antigravity"
}

export const antigravityParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    let sessionModel: string | null = null

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>
        const rowType = obj.type as string | undefined

        if (rowType === "session_meta") {
          const modelId = obj.modelId as string | undefined
          if (modelId && modelId.trim()) sessionModel = modelId
          continue
        }

        if (rowType !== "usage") continue

        const sessionId = obj.sessionId as string
        if (!sessionId) continue
        const timestamp = extractI64(obj.timestamp)
        if (timestamp <= 0) continue

        const modelId = (obj.modelId as string)?.trim() || (sessionModel?.trim()) || "unknown"
        const providerId = ((obj.providerId as string)?.trim()) || inferProvider(modelId)

        const input = Math.max(0, extractI64(obj.input))
        const output = Math.max(0, extractI64(obj.output))
        const cacheRead = Math.max(0, extractI64(obj.cacheRead))
        const cacheWrite = Math.max(0, extractI64(obj.cacheWrite))
        const reasoning = Math.max(0, extractI64(obj.reasoning))
        if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0 && reasoning === 0) continue

        const responseId = (obj.responseId as string) || undefined

        messages.push({
          client: "antigravity",
          modelId,
          providerId,
          sessionId,
          timestamp,
          date: timestampToLocalDate(timestamp),
          tokens: { input, output, cacheRead, cacheWrite, reasoning },
          cost: 0,
          dedupKey: responseId,
          messageCount: 1,
          isTurnStart: false,
        })
      } catch { /* skip */ }
    }

    return messages
  },
}
