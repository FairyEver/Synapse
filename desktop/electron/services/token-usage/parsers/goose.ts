import { DatabaseSync } from "node:sqlite"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

export const gooseParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)

    try {
      const db = new DatabaseSync(filePath, { open: true, readOnly: true })
      try {
        const rows = db.prepare(`
          SELECT id, model_config_json, provider_name, created_at,
                 total_tokens, input_tokens, output_tokens,
                 accumulated_total_tokens, accumulated_input_tokens, accumulated_output_tokens
          FROM sessions
          WHERE model_config_json IS NOT NULL AND TRIM(model_config_json) != ''
        `).all() as Record<string, unknown>[]

        for (const row of rows) {
          const input = extractI64(row.accumulated_input_tokens) || extractI64(row.input_tokens)
          const output = extractI64(row.accumulated_output_tokens) || extractI64(row.output_tokens)
          if (input + output === 0) continue

          let model = "unknown"
          try {
            const config = JSON.parse(row.model_config_json as string)
            model = (config.model_name as string) || "unknown"
          } catch { /* skip */ }

          const total = extractI64(row.accumulated_total_tokens) || extractI64(row.total_tokens)
          const reasoning = total > input + output ? total - input - output : 0

          const provider = (row.provider_name as string)?.toLowerCase() || inferProvider(model)
          const ts = parseTimestamp(row.created_at) || fallbackTs

          messages.push({
            client: "goose",
            modelId: model,
            providerId: provider || "goose",
            sessionId: String(row.id || ""),
            timestamp: ts,
            date: timestampToLocalDate(ts),
            tokens: {
              input,
              output,
              cacheRead: 0,
              cacheWrite: 0,
              reasoning,
            },
            cost: 0,
            messageCount: 1,
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

function inferProvider(model: string): string {
  const m = model.toLowerCase()
  if (m.includes("claude")) return "anthropic"
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai"
  if (m.includes("gemini")) return "google"
  if (m.includes("deepseek")) return "deepseek"
  return "goose"
}
