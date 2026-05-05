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
          let model = ""
          try {
            const config = JSON.parse(row.model_config_json as string)
            model = ((config.model_name as string) || "").trim()
          } catch { /* skip */ }
          if (!model) continue

          const accInput = row.accumulated_input_tokens
          const accOutput = row.accumulated_output_tokens
          const accTotal = row.accumulated_total_tokens
          const input = Math.max(0, accInput != null ? extractI64(accInput) : extractI64(row.input_tokens))
          const output = Math.max(0, accOutput != null ? extractI64(accOutput) : extractI64(row.output_tokens))
          const total = Math.max(0, accTotal != null ? extractI64(accTotal) : extractI64(row.total_tokens))

          if (input === 0 && output === 0 && total === 0) continue

          const reasoning = total > input + output ? total - input - output : 0

          const providerRaw = (row.provider_name as string) || ""
          const provider = providerRaw.trim() ? providerRaw.trim().toLowerCase() : inferProvider(model)
          const ts = parseTimestamp(row.created_at) || fallbackTs
          const sessionId = String(row.id || "")

          messages.push({
            client: "goose",
            modelId: model,
            providerId: provider || "goose",
            sessionId,
            dedupKey: sessionId,
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
