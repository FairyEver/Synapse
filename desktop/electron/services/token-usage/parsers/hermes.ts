import { DatabaseSync } from "node:sqlite"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

export const hermesParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)

    try {
      const db = new DatabaseSync(filePath, { open: true, readOnly: true })
      try {
        const rows = db.prepare(`
          SELECT id, model, billing_provider, started_at,
                 message_count, input_tokens, output_tokens,
                 cache_read_tokens, cache_write_tokens, reasoning_tokens,
                 estimated_cost_usd, actual_cost_usd
          FROM sessions
          WHERE model IS NOT NULL AND TRIM(model) != ''
            AND (COALESCE(input_tokens, 0) > 0 OR COALESCE(output_tokens, 0) > 0
              OR COALESCE(cache_read_tokens, 0) > 0 OR COALESCE(cache_write_tokens, 0) > 0
              OR COALESCE(reasoning_tokens, 0) > 0 OR COALESCE(actual_cost_usd, 0) > 0)
        `).all() as Record<string, unknown>[]

        for (const row of rows) {
          const input = extractI64(row.input_tokens)
          const output = extractI64(row.output_tokens)
          const cost = typeof row.actual_cost_usd === "number" ? row.actual_cost_usd
            : typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : 0
          const ts = parseTimestamp(row.started_at) || fallbackTs

          messages.push({
            client: "hermes",
            modelId: (row.model as string) || "unknown",
            providerId: canonicalizeProvider(row.billing_provider as string, row.model as string),
            sessionId: String(row.id || ""),
            timestamp: ts,
            date: timestampToLocalDate(ts),
            tokens: {
              input,
              output,
              cacheRead: extractI64(row.cache_read_tokens),
              cacheWrite: extractI64(row.cache_write_tokens),
              reasoning: extractI64(row.reasoning_tokens),
            },
            cost,
            messageCount: extractI64(row.message_count) || 1,
            isTurnStart: false,
          })
        }
      } finally {
        db.close()
      }
    } catch { /* skip */ }

    return messages
  },
}

function canonicalizeProvider(provider: string | undefined, model: string | undefined): string {
  if (provider && provider.trim()) return provider.trim().toLowerCase()
  return inferProvider(model || "")
}

function inferProvider(model: string): string {
  const m = model.toLowerCase()
  if (m.includes("claude")) return "anthropic"
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai"
  if (m.includes("gemini")) return "google"
  if (m.includes("deepseek")) return "deepseek"
  return "hermes"
}
