import fs from "node:fs"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

export const muxParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)

    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      const byModel = data.byModel as Record<string, Record<string, unknown>> | undefined
      if (!byModel) return messages

      const lastReq = data.lastRequest as Record<string, unknown> | undefined
      const ts = parseTimestamp(lastReq?.timestamp) || fallbackTs

      for (const [key, usage] of Object.entries(byModel)) {
        const parts = key.split(":")
        const provider = parts.length > 1 ? parts[0] : "unknown"
        const model = parts.length > 1 ? parts.slice(1).join(":") : key

        const inputObj = usage.input as Record<string, unknown> | undefined
        const outputObj = usage.output as Record<string, unknown> | undefined
        const cachedObj = usage.cached as Record<string, unknown> | undefined
        const cacheCreateObj = usage.cacheCreate as Record<string, unknown> | undefined
        const reasoningObj = usage.reasoning as Record<string, unknown> | undefined

        const input = extractI64(inputObj?.tokens)
        const output = extractI64(outputObj?.tokens)
        if (input + output === 0) continue

        const cost = [inputObj, outputObj, cachedObj, cacheCreateObj, reasoningObj]
          .reduce((sum, o) => sum + (typeof (o as Record<string, unknown>)?.cost_usd === "number" ? (o as Record<string, unknown>).cost_usd as number : 0), 0)

        messages.push({
          client: "mux",
          modelId: model,
          providerId: provider,
          sessionId: "",
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: {
            input,
            output,
            cacheRead: extractI64(cachedObj?.tokens),
            cacheWrite: extractI64(cacheCreateObj?.tokens),
            reasoning: extractI64(reasoningObj?.tokens),
          },
          cost,
          messageCount: 1,
          isTurnStart: false,
        })
      }
    } catch { /* skip */ }

    return messages
  },
}
