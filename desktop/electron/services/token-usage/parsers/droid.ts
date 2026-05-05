import fs from "node:fs"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function normalizeModel(raw: string): string {
  let m = raw.replace(/^custom:/, "")
  m = m.replace(/\[.*?\]/g, "")
  m = m.replace(/-+$/, "")
  m = m.toLowerCase()
  m = m.replace(/\./g, "-")
  m = m.replace(/-+/g, "-")
  return m || "unknown"
}

function getDefaultModelFromProvider(provider: string): string {
  const p = provider.toLowerCase()
  if (p === "anthropic") return "claude-unknown"
  if (p === "openai") return "gpt-unknown"
  if (p === "google") return "gemini-unknown"
  if (p === "xai") return "grok-unknown"
  return `${p || "unknown"}-unknown`
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
      const cacheRead = extractI64(usage.cacheReadTokens)
      const cacheWrite = extractI64(usage.cacheCreationTokens)
      const reasoning = extractI64(usage.thinkingTokens)
      if (input + output + cacheRead + cacheWrite + reasoning === 0) return []

      const provider = (data.providerLock as string) || inferProvider((data.model as string) || "")

      let model = (data.model as string) || ""
      if (!model) {
        const jsonlPath = filePath.replace(/\.settings\.json$/, ".jsonl")
        model = scanJsonlForModel(jsonlPath)
      }
      if (model) {
        model = normalizeModel(model)
      } else {
        model = getDefaultModelFromProvider(provider)
      }

      const ts = parseTimestamp(data.providerLockTimestamp) || fallbackTs
      if (ts === 0) return []

      const sessionId = path.basename(filePath).replace(/\.settings\.json$/, "")

      return [{
        client: "droid",
        modelId: model,
        providerId: provider,
        sessionId,
        timestamp: ts,
        date: timestampToLocalDate(ts),
        tokens: {
          input: Math.max(0, input),
          output: Math.max(0, output),
          cacheRead: Math.max(0, cacheRead),
          cacheWrite: Math.max(0, cacheWrite),
          reasoning: Math.max(0, reasoning),
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
