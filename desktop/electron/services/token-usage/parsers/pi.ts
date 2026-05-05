import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, fileModifiedMs, timestampToLocalDate } from "./utils"

function parseRfc3339(ts: string): number | null {
  const d = new Date(ts)
  return Number.isFinite(d.getTime()) ? d.getTime() : null
}

function workspaceFromCwd(cwd: string | undefined): { key?: string; label?: string } {
  if (!cwd || !cwd.trim()) return {}
  const key = cwd.trim()
  const label = key.split(/[/\\]/).pop() || key
  return { key, label }
}

export const piParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    let sessionId: string | undefined
    let workspace: { key?: string; label?: string } = {}
    let headerParsed = false

    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>

        if (!headerParsed) {
          headerParsed = true
          if (obj.type !== "session") return []
          sessionId = (obj.id as string) || path.basename(filePath, ".jsonl")
          workspace = workspaceFromCwd(obj.cwd as string | undefined)
          continue
        }

        if (obj.type !== "message") continue

        const message = obj.message as Record<string, unknown> | undefined
        if (!message) continue
        if (message.role !== "assistant") continue

        const usage = message.usage as Record<string, unknown> | undefined
        if (!usage) continue

        const model = message.model as string | undefined
        if (!model) continue

        const provider = message.provider as string | undefined
        if (!provider) continue

        const input = Math.max(0, extractI64(usage.input))
        const output = Math.max(0, extractI64(usage.output))
        const cacheRead = Math.max(0, extractI64(usage.cacheRead ?? usage.cache_read))
        const cacheWrite = Math.max(0, extractI64(usage.cacheWrite ?? usage.cache_write))
        if (input + output + cacheRead + cacheWrite === 0) continue

        const ts = (obj.timestamp ? parseRfc3339(obj.timestamp as string) : null) || fallbackTs

        messages.push({
          client: "pi",
          modelId: model,
          providerId: provider,
          sessionId: sessionId || "",
          workspaceKey: workspace.key,
          workspaceLabel: workspace.label,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: { input, output, cacheRead, cacheWrite, reasoning: 0 },
          cost: 0,
          messageCount: 1,
          isTurnStart: false,
        })
      } catch { /* skip malformed lines */ }
    }

    return messages
  },
}
