import fs from "node:fs"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

export const ampParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)

    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      const ledger = data.usageLedger as Record<string, unknown> | undefined
      const events = (ledger?.events || []) as Record<string, unknown>[]

      for (const event of events) {
        const tokens = event.tokens as Record<string, unknown> | undefined
        if (!tokens) continue
        const input = extractI64(tokens.input)
        const output = extractI64(tokens.output)
        if (input + output === 0) continue

        const ts = parseTimestamp(event.timestamp) || fallbackTs
        messages.push({
          client: "amp",
          modelId: (event.model as string) || "unknown",
          providerId: "anthropic",
          sessionId: (data.id as string) || "",
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: {
            input,
            output,
            cacheRead: extractI64(tokens.cacheReadInputTokens),
            cacheWrite: extractI64(tokens.cacheCreationInputTokens),
            reasoning: 0,
          },
          cost: 0,
          messageCount: 1,
          isTurnStart: false,
        })
      }
    } catch { /* skip */ }

    return messages
  },
}
