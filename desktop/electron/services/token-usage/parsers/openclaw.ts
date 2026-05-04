import fs from "node:fs"
import readline from "node:readline"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

export const openclawParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)

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

        const model = (msg.model as string) || currentModel
        const provider = (msg.provider as string) || currentProvider || "unknown"
        if (!model) continue

        currentModel = model
        currentProvider = provider

        const input = extractI64(usage.input)
        const output = extractI64(usage.output)
        if (input + output === 0) continue

        const costObj = usage.cost as Record<string, unknown> | undefined
        const ts = parseTimestamp(msg.timestamp) || fallbackTs

        messages.push({
          client: "openclaw",
          modelId: model,
          providerId: provider,
          sessionId: "",
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: {
            input,
            output,
            cacheRead: extractI64(usage.cacheRead),
            cacheWrite: extractI64(usage.cacheWrite),
            reasoning: 0,
          },
          cost: typeof costObj?.total === "number" ? costObj.total as number : 0,
          messageCount: 1,
          isTurnStart: false,
        })
      } catch { /* skip */ }
    }

    return messages
  },
}
