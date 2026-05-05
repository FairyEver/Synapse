import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function extractSessionIdWithFallback(filePath: string, jsonSessionId: string | undefined): string {
  if (jsonSessionId && jsonSessionId.trim()) return jsonSessionId.trim()
  const filename = path.basename(filePath, path.extname(filePath))
  const projectName = path.basename(path.dirname(path.dirname(filePath))) || "unknown"
  return `${projectName}-${filename}`
}

function qwenWorkspaceFromPath(filePath: string): { key?: string; label?: string } {
  const segments = filePath.split(path.sep)
  for (let i = segments.length - 1; i >= 3; i--) {
    if (segments[i - 2] === "projects" && segments[i] === "chats" && segments[i - 1]) {
      const key = segments[i - 1]
      const label = key.split(/[/\\]/).pop() || key
      return { key, label }
    }
  }
  return {}
}

export const qwenParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)
    const workspace = qwenWorkspaceFromPath(filePath)

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>
        if (obj.type !== "assistant") continue

        const usage = obj.usageMetadata as Record<string, unknown> | undefined
        if (!usage) continue

        const input = Math.max(0, extractI64(usage.promptTokenCount))
        const output = Math.max(0, extractI64(usage.candidatesTokenCount))
        const reasoning = Math.max(0, extractI64(usage.thoughtsTokenCount))
        const cacheRead = Math.max(0, extractI64(usage.cachedContentTokenCount))

        if (input + output + cacheRead + reasoning === 0) continue

        const model = (obj.model as string) || "unknown"
        const sessionId = extractSessionIdWithFallback(filePath, obj.sessionId as string | undefined)
        const ts = parseTimestamp(obj.timestamp) || fallbackTs

        messages.push({
          client: "qwen",
          modelId: model,
          providerId: "qwen",
          sessionId,
          workspaceKey: workspace.key,
          workspaceLabel: workspace.label,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: { input, output, cacheRead, cacheWrite: 0, reasoning },
          cost: 0,
          messageCount: 1,
          isTurnStart: false,
        })
      } catch { /* skip malformed lines */ }
    }

    return messages
  },
}
