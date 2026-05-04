import fs from "node:fs"
import readline from "node:readline"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function tryNum(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = extractI64(obj[k])
    if (v > 0) return v
  }
  return 0
}

function parseSessionJson(filePath: string, fallbackTs: number): UnifiedMessage[] {
  const messages: UnifiedMessage[] = []
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    const msgs = data.messages as Record<string, unknown>[] | undefined
    if (!Array.isArray(msgs)) return parseHeadlessJson(data, filePath, fallbackTs)

    for (const msg of msgs) {
      const tokens = msg.tokens as Record<string, unknown> | undefined
      if (!tokens) continue
      const input = extractI64(tokens.input)
      const output = extractI64(tokens.output)
      if (input + output === 0) continue

      const ts = parseTimestamp(msg.timestamp) || fallbackTs
      messages.push({
        client: "gemini",
        modelId: (msg.model as string) || (data.model as string) || "unknown",
        providerId: "google",
        sessionId: "",
        timestamp: ts,
        date: timestampToLocalDate(ts),
        tokens: {
          input,
          output,
          cacheRead: extractI64(tokens.cached),
          cacheWrite: 0,
          reasoning: extractI64(tokens.thoughts),
        },
        cost: 0,
        messageCount: 1,
        isTurnStart: false,
      })
    }
  } catch { /* skip */ }
  return messages
}

function parseHeadlessJson(data: Record<string, unknown>, filePath: string, fallbackTs: number): UnifiedMessage[] {
  const messages: UnifiedMessage[] = []
  const stats = data.stats as Record<string, unknown> | undefined
  if (!stats) return messages
  const models = stats.models as Record<string, Record<string, unknown>> | undefined
  if (models) {
    for (const [modelId, info] of Object.entries(models)) {
      const tokens = info.tokens as Record<string, unknown> | undefined
      if (!tokens) continue
      const input = tryNum(tokens, "prompt", "input", "input_tokens")
      const output = tryNum(tokens, "candidates", "output", "output_tokens")
      if (input + output === 0) continue
      messages.push({
        client: "gemini",
        modelId,
        providerId: "google",
        sessionId: "",
        timestamp: fallbackTs,
        date: timestampToLocalDate(fallbackTs),
        tokens: {
          input,
          output,
          cacheRead: tryNum(tokens, "cached", "cached_tokens"),
          cacheWrite: 0,
          reasoning: tryNum(tokens, "thoughts", "reasoning"),
        },
        cost: 0,
        messageCount: 1,
        isTurnStart: false,
      })
    }
  }
  return messages
}

async function parseJsonlFile(filePath: string, fallbackTs: number): Promise<UnifiedMessage[]> {
  const messages: UnifiedMessage[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    try {
      const obj = JSON.parse(line)
      const stats = (obj.stats || obj) as Record<string, unknown>
      const input = tryNum(stats, "input_tokens", "prompt_tokens")
      const output = tryNum(stats, "output_tokens", "candidates_tokens")
      if (input + output === 0) continue

      const ts = parseTimestamp(obj.timestamp) || fallbackTs
      messages.push({
        client: "gemini",
        modelId: (obj.model as string) || "unknown",
        providerId: "google",
        sessionId: "",
        timestamp: ts,
        date: timestampToLocalDate(ts),
        tokens: {
          input,
          output,
          cacheRead: tryNum(stats, "cached_tokens"),
          cacheWrite: 0,
          reasoning: tryNum(stats, "thoughts_tokens", "reasoning_tokens"),
        },
        cost: 0,
        messageCount: 1,
        isTurnStart: false,
      })
    } catch { /* skip */ }
  }
  return messages
}

export const geminiParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const fallbackTs = fileModifiedMs(filePath)
    if (filePath.endsWith(".jsonl")) {
      return parseJsonlFile(filePath, fallbackTs)
    }
    return parseSessionJson(filePath, fallbackTs)
  },
}
