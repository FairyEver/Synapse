import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

interface DedupEntry {
  msg: UnifiedMessage
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const INTERNAL_TAGS = [
  "<local-command-stdout>", "<local-command-stderr>",
  "<command-name>", "<command-message>",
  "<system-reminder>", "<bash-input>",
  "<bash-stdout>", "<bash-stderr>",
]

function isHumanTurn(content: unknown): boolean {
  if (Array.isArray(content)) return false
  if (typeof content !== "string") return false
  const trimmed = content.trimStart()
  return !INTERNAL_TAGS.some((tag) => trimmed.startsWith(tag))
}

function extractWorkspace(filePath: string): { key?: string; label?: string } {
  const segments = filePath.split(path.sep)
  for (let i = 0; i < segments.length - 2; i++) {
    if (segments[i] === ".claude" && segments[i + 1] === "projects") {
      const key = segments[i + 2]
      if (key) return { key, label: key.split(/[-/]/).pop() || key }
    }
  }
  return {}
}

export const claudeParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const dedup = new Map<string, DedupEntry>()
    const fallbackTs = fileModifiedMs(filePath)
    const workspace = extractWorkspace(filePath)

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.includes('"type":"assistant"')) continue
      try {
        const obj = JSON.parse(line)
        if (obj.type !== "assistant") continue
        const msg = obj.message
        if (!msg?.usage) continue

        const usage = msg.usage
        const input = Math.max(0, extractI64(usage.input_tokens))
        const output = Math.max(0, extractI64(usage.output_tokens))
        const cacheRead = Math.max(0, extractI64(usage.cache_read_input_tokens))
        const cacheWrite = Math.max(0, extractI64(usage.cache_creation_input_tokens))

        if (input + output === 0) continue

        const messageId = msg.id || ""
        const requestId = obj.requestId || ""
        const dedupKey = `${messageId}:${requestId}`

        const ts = parseTimestamp(obj.timestamp) || fallbackTs
        const isTurnStart = obj.parentMessageId
          ? isHumanTurn(obj.parentMessageContent)
          : false

        if (dedupKey !== ":" && dedup.has(dedupKey)) {
          const existing = dedup.get(dedupKey)!
          existing.input = Math.max(existing.input, input)
          existing.output = Math.max(existing.output, output)
          existing.cacheRead = Math.max(existing.cacheRead, cacheRead)
          existing.cacheWrite = Math.max(existing.cacheWrite, cacheWrite)
          existing.msg.tokens = {
            input: existing.input,
            output: existing.output,
            cacheRead: existing.cacheRead,
            cacheWrite: existing.cacheWrite,
            reasoning: 0,
          }
          continue
        }

        const unified: UnifiedMessage = {
          client: "claude",
          modelId: msg.model || "unknown",
          providerId: "anthropic",
          sessionId: obj.sessionId || "",
          workspaceKey: workspace.key,
          workspaceLabel: workspace.label,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: { input, output, cacheRead, cacheWrite, reasoning: 0 },
          cost: 0,
          messageCount: 1,
          agent: obj.isSidechain ? (obj.agentId || "claude-code-subagent") : undefined,
          dedupKey: dedupKey !== ":" ? dedupKey : undefined,
          isTurnStart,
        }

        if (dedupKey !== ":") {
          dedup.set(dedupKey, { msg: unified, input, output, cacheRead, cacheWrite })
        } else {
          dedup.set(`anon-${dedup.size}`, { msg: unified, input, output, cacheRead, cacheWrite })
        }
      } catch {
        // skip malformed lines
      }
    }

    return Array.from(dedup.values()).map((e) => e.msg)
  },
}
