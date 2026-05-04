import fs from "node:fs"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function normalizeModel(raw: string): string {
  let m = raw.replace(/^custom:/, "")
  m = m.replace(/\[.*?\]/g, "")
  m = m.toLowerCase().replace(/\./g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
  return m || "unknown"
}

function inferProvider(model: string): string {
  const m = model.toLowerCase()
  if (m.includes("claude")) return "anthropic"
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai"
  if (m.includes("gemini")) return "google"
  if (m.includes("deepseek")) return "deepseek"
  return "unknown"
}

export const droidParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const fallbackTs = fileModifiedMs(filePath)

    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      const usage = data.tokenUsage as Record<string, unknown> | undefined
      if (!usage) return []

      const input = extractI64(usage.inputTokens)
      const output = extractI64(usage.outputTokens)
      if (input + output === 0) return []

      let model = (data.model as string) || ""
      if (!model) {
        const jsonlPath = filePath.replace(/\.settings\.json$/, ".jsonl")
        model = scanJsonlForModel(jsonlPath)
      }
      model = normalizeModel(model)

      const provider = (data.providerLock as string) || inferProvider(model)
      const ts = parseTimestamp(data.providerLockTimestamp) || fallbackTs
      const sessionId = path.basename(filePath).replace(/\.settings\.json$/, "")

      return [{
        client: "droid",
        modelId: model,
        providerId: provider,
        sessionId,
        timestamp: ts,
        date: timestampToLocalDate(ts),
        tokens: {
          input,
          output,
          cacheRead: extractI64(usage.cacheReadTokens),
          cacheWrite: extractI64(usage.cacheCreationTokens),
          reasoning: extractI64(usage.thinkingTokens),
        },
        cost: 0,
        messageCount: 1,
        isTurnStart: false,
      }]
    } catch { /* skip */ }

    return []
  },
}

function scanJsonlForModel(jsonlPath: string): string {
  try {
    const content = fs.readFileSync(jsonlPath, "utf-8")
    const lines = content.split("\n").slice(0, 500)
    for (const line of lines) {
      const match = line.match(/Model:\s*(.+)/i)
      if (match) return match[1].trim()
    }
  } catch { /* skip */ }
  return "unknown"
}
