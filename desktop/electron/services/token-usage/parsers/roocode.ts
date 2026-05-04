import fs from "node:fs"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, fileModifiedMs, timestampToLocalDate } from "./utils"

function createRooStyleParser(clientId: string): AgentParser {
  return {
    async parseFile(filePath: string): Promise<UnifiedMessage[]> {
      const messages: UnifiedMessage[] = []
      const fallbackTs = fileModifiedMs(filePath)

      try {
        const entries = JSON.parse(fs.readFileSync(filePath, "utf-8"))
        if (!Array.isArray(entries)) return messages

        for (const entry of entries) {
          if (entry.type !== "say" || entry.say !== "api_req_started") continue
          const text = entry.text as string | undefined
          if (!text) continue

          try {
            const payload = JSON.parse(text)
            const input = extractI64(payload.tokensIn)
            const output = extractI64(payload.tokensOut)
            if (input + output === 0) continue

            const ts = entry.ts ? Number(entry.ts) : fallbackTs
            messages.push({
              client: clientId,
              modelId: (payload.model as string) || "unknown",
              providerId: inferProvider(payload.model as string),
              sessionId: "",
              timestamp: ts,
              date: timestampToLocalDate(ts),
              tokens: {
                input,
                output,
                cacheRead: extractI64(payload.cacheReads),
                cacheWrite: extractI64(payload.cacheWrites),
                reasoning: 0,
              },
              cost: typeof payload.cost === "number" ? payload.cost : 0,
              messageCount: 1,
              isTurnStart: false,
            })
          } catch { /* skip malformed text */ }
        }
      } catch { /* skip */ }

      return messages
    },
  }
}

function inferProvider(model: string): string {
  if (!model) return "unknown"
  const m = model.toLowerCase()
  if (m.includes("claude")) return "anthropic"
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai"
  if (m.includes("gemini")) return "google"
  if (m.includes("deepseek")) return "deepseek"
  return "unknown"
}

export const roocodeParser = createRooStyleParser("roocode")
export const kilocodeParser = createRooStyleParser("kilocode")
