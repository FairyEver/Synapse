import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function deriveSessionId(filePath: string): string {
  const filename = path.basename(filePath)
  const idx = filename.indexOf(".jsonl")
  if (idx > 0) return filename.slice(0, idx)
  return ""
}

export const openclawParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)
    const sessionId = deriveSessionId(filePath)

    let currentModel = ""
    let currentProvider = ""

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      try {
        const obj = JSON.parse(line)
        const type = obj.type as string | undefined

        if (type === "model_change") {
          currentModel = (obj.modelId as string) || currentModel
          currentProvider = (obj.provider as string) || currentProvider
          continue
        }

        if (type === "custom") {
          const customType = obj.customType as string | undefined
          if (customType === "model-snapshot") {
            const data = obj.data as Record<string, unknown> | undefined
            if (data) {
              currentModel = (data.modelId as string) || currentModel
              currentProvider = (data.provider as string) || currentProvider
            }
          }
          continue
        }

        if (type !== "message") continue
        const msg = obj.message as Record<string, unknown> | undefined
        if (!msg || msg.role !== "assistant") continue

        const usage = msg.usage as Record<string, unknown> | undefined
        if (!usage) continue

        const model = ((msg.model as string) || "").trim() || ((currentModel || "").trim()) || ""
        const provider = ((msg.provider as string) || "").trim() || ((currentProvider || "").trim()) || "unknown"
        if (!model) continue

        currentModel = model
        currentProvider = provider

        const costObj = usage.cost as Record<string, unknown> | undefined
        const ts = parseTimestamp(msg.timestamp) || fallbackTs
        const cost = typeof costObj?.total === "number" ? Math.max(0, costObj.total as number) : 0

        messages.push({
          client: "openclaw",
          modelId: model,
          providerId: provider,
          sessionId,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: {
            input: Math.max(0, extractI64(usage.input)),
            output: Math.max(0, extractI64(usage.output)),
            cacheRead: Math.max(0, extractI64(usage.cacheRead)),
            cacheWrite: Math.max(0, extractI64(usage.cacheWrite)),
            reasoning: 0,
          },
          cost,
          messageCount: 1,
          isTurnStart: false,
        })
      } catch { /* skip */ }
    }

    return messages
  },
}
