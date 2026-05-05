import fs from "node:fs"
import path from "node:path"
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

      const sessionId = path.basename(path.dirname(filePath)) || ""

      for (const [key, usage] of Object.entries(byModel)) {
        const colonIdx = key.indexOf(":")
        const provider = colonIdx >= 0 ? key.slice(0, colonIdx) : ""
        const model = colonIdx >= 0 ? key.slice(colonIdx + 1) : key

        const inputObj = usage.input as Record<string, unknown> | undefined
        const outputObj = usage.output as Record<string, unknown> | undefined
        const cachedObj = usage.cached as Record<string, unknown> | undefined
        const cacheCreateObj = usage.cacheCreate as Record<string, unknown> | undefined
        const reasoningObj = usage.reasoning as Record<string, unknown> | undefined

        const input = Math.max(0, extractI64(inputObj?.tokens))
        const output = Math.max(0, extractI64(outputObj?.tokens))
        const cacheRead = Math.max(0, extractI64(cachedObj?.tokens))
        const cacheWrite = Math.max(0, extractI64(cacheCreateObj?.tokens))
        const reasoning = Math.max(0, extractI64(reasoningObj?.tokens))

        if (input === 0 && cacheRead === 0 && cacheWrite === 0 && output === 0 && reasoning === 0) continue

        const costOf = (o: Record<string, unknown> | undefined) =>
          typeof o?.cost_usd === "number" ? (o.cost_usd as number) : 0
        const cost = costOf(inputObj) + costOf(outputObj) + costOf(cachedObj) + costOf(cacheCreateObj) + costOf(reasoningObj)

        messages.push({
          client: "mux",
          modelId: model,
          providerId: provider,
          sessionId,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: { input, output, cacheRead, cacheWrite, reasoning },
          cost,
          messageCount: 1,
          isTurnStart: false,
        })
      }
    } catch { /* skip */ }

    return messages
  },
}
