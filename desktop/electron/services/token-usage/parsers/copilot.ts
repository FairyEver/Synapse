import fs from "node:fs"
import readline from "node:readline"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function attrStr(attrs: Record<string, unknown>, key: string): string {
  const v = attrs[key]
  if (typeof v === "string") return v
  if (Array.isArray(v) && typeof v[0] === "string") return v[0]
  return ""
}

function attrI64(attrs: Record<string, unknown>, key: string): number {
  return extractI64(attrs[key])
}

export const copilotParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)
    const seen = new Set<string>()

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.includes("gen_ai")) continue
      try {
        const obj = JSON.parse(line)
        const attrs = (obj.attributes || {}) as Record<string, unknown>
        const opName = attrStr(attrs, "gen_ai.operation.name")
        const name = (obj.name as string) || ""
        if (opName !== "chat" && !name.startsWith("chat ")) continue

        const input = attrI64(attrs, "gen_ai.usage.input_tokens")
        const output = attrI64(attrs, "gen_ai.usage.output_tokens")
        if (input + output === 0) continue

        const model = attrStr(attrs, "gen_ai.response.model") || attrStr(attrs, "gen_ai.request.model") || "unknown"
        const convId = attrStr(attrs, "gen_ai.conversation.id") || attrStr(attrs, "github.copilot.interaction_id") || attrStr(attrs, "gen_ai.response.id")

        if (convId && seen.has(convId)) continue
        if (convId) seen.add(convId)

        let ts = fallbackTs
        const endTime = obj.endTime as [number, number] | undefined
        const startTime = obj.startTime as [number, number] | undefined
        const timeArr = endTime || startTime
        if (Array.isArray(timeArr) && timeArr.length === 2) {
          ts = timeArr[0] * 1000 + Math.floor(timeArr[1] / 1_000_000)
        } else if (obj.timestamp) {
          ts = parseTimestamp(obj.timestamp) || fallbackTs
        }

        messages.push({
          client: "copilot",
          modelId: model,
          providerId: "github",
          sessionId: convId,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: {
            input,
            output,
            cacheRead: attrI64(attrs, "gen_ai.usage.cache_read.input_tokens"),
            cacheWrite: attrI64(attrs, "gen_ai.usage.cache_write.input_tokens"),
            reasoning: attrI64(attrs, "gen_ai.usage.reasoning.output_tokens"),
          },
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
