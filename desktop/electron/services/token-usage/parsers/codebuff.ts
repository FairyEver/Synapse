import fs from "node:fs"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

interface TokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

function extractUsageFromObj(obj: Record<string, unknown>): TokenUsage {
  return {
    input: extractI64(obj.inputTokens ?? obj.input_tokens ?? obj.promptTokens ?? obj.prompt_tokens),
    output: extractI64(obj.outputTokens ?? obj.output_tokens ?? obj.completionTokens ?? obj.completion_tokens),
    cacheRead: extractI64(obj.cacheReadInputTokens ?? obj.cache_read_input_tokens ?? obj.cachedTokensCreated ?? obj.cached_tokens_created)
      || extractI64((obj.promptTokensDetails as Record<string, unknown>)?.cachedTokens ?? (obj.prompt_tokens_details as Record<string, unknown>)?.cached_tokens),
    cacheWrite: extractI64(obj.cacheCreationInputTokens ?? obj.cache_creation_input_tokens ?? obj.cacheCreationTokens ?? obj.cache_creation_tokens),
  }
}

function mergeUsage(base: TokenUsage, fallback: TokenUsage): TokenUsage {
  return {
    input: base.input || fallback.input,
    output: base.output || fallback.output,
    cacheRead: base.cacheRead || fallback.cacheRead,
    cacheWrite: base.cacheWrite || fallback.cacheWrite,
  }
}

export const codebuffParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)

    try {
      const entries = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      if (!Array.isArray(entries)) return messages

      for (const entry of entries) {
        const variant = (entry.variant as string) || (entry.role as string) || ""
        if (!["ai", "agent", "assistant"].includes(variant.toLowerCase())) continue

        const metadata = entry.metadata as Record<string, unknown> | undefined
        let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        let model = (metadata?.model as string) || ""

        const p1 = metadata?.usage as Record<string, unknown> | undefined
        if (p1) {
          usage = mergeUsage(extractUsageFromObj(p1), usage)
          if (!model) model = (p1.model as string) || ""
        }

        const codebuff = metadata?.codebuff as Record<string, unknown> | undefined
        const p2 = codebuff?.usage as Record<string, unknown> | undefined
        if (p2) {
          usage = mergeUsage(usage, extractUsageFromObj(p2))
          if (!model) model = (p2.model as string) || ""
        }

        if (usage.input + usage.output === 0) {
          const runState = metadata?.runState as Record<string, unknown> | undefined
          const sessionState = runState?.sessionState as Record<string, unknown> | undefined
          const mainAgent = sessionState?.mainAgentState as Record<string, unknown> | undefined
          const history = mainAgent?.messageHistory as Record<string, unknown>[] | undefined
          if (Array.isArray(history)) {
            for (let i = history.length - 1; i >= 0; i--) {
              const h = history[i]
              const po = h.providerOptions as Record<string, unknown> | undefined
              if (!po) continue
              const poUsage = po.usage as Record<string, unknown> | undefined
              if (poUsage) usage = mergeUsage(usage, extractUsageFromObj(poUsage))
              const poCb = po.codebuff as Record<string, unknown> | undefined
              const poCbUsage = poCb?.usage as Record<string, unknown> | undefined
              if (poCbUsage) {
                usage = mergeUsage(usage, extractUsageFromObj(poCbUsage))
                if (!model) model = (poCb?.model as string) || ""
              }
              if (usage.input + usage.output > 0) break
            }
          }
        }

        if (usage.input + usage.output === 0) continue

        const credits = typeof entry.credits === "number" ? entry.credits : (typeof p1?.credits === "number" ? p1.credits as number : 0)
        const ts = parseTimestamp(entry.timestamp ?? entry.createdAt ?? metadata?.timestamp) || fallbackTs

        messages.push({
          client: "codebuff",
          modelId: model || "unknown",
          providerId: inferProvider(model),
          sessionId: "",
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, reasoning: 0 },
          cost: credits,
          messageCount: 1,
          isTurnStart: false,
        })
      }
    } catch { /* skip */ }

    return messages
  },
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
