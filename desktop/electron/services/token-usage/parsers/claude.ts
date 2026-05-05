import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate, normalizeAgentName, normalizeWorkspaceKey, workspaceLabelFromKey } from "./utils"

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

function isHumanTurn(rawLine: string): boolean {
  const contentIdx = rawLine.indexOf('"content":')
  if (contentIdx < 0) return false
  const after = rawLine.slice(contentIdx + 10).trimStart()
  if (after.startsWith("[")) return false
  if (after.startsWith('"')) {
    const contentStart = after.slice(1)
    return !INTERNAL_TAGS.some((tag) => contentStart.startsWith(tag))
  }
  return false
}

function extractWorkspace(filePath: string): { key?: string; label?: string } {
  const segments = filePath.split(path.sep)
  for (let i = 0; i < segments.length - 2; i++) {
    if (segments[i] === ".claude" && segments[i + 1] === "projects") {
      const rawKey = segments[i + 2]
      if (rawKey) {
        const key = normalizeWorkspaceKey(rawKey) ?? rawKey
        const label = workspaceLabelFromKey(key) ?? key
        return { key, label }
      }
    }
  }
  return {}
}

function sidechainAgentIdFromStem(stem: string): string | null {
  if (!stem.startsWith("agent-")) return null
  const agentStem = stem.slice(6)
  if (!agentStem.includes("-")) return agentStem
  const trailing = agentStem.split("-").pop() || ""
  if (/^[0-9a-f]+$/i.test(trailing)) return trailing
  return agentStem
}

function resolveSubagentName(filePath: string, sessionId: string | undefined, agentId: string | undefined): string {
  const stem = path.basename(filePath, path.extname(filePath))

  // Tier 1: sibling meta.json
  const metaPath = path.join(path.dirname(filePath), `${stem}.meta.json`)
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
    if (meta.agentType && meta.agentType.trim()) {
      return normalizeAgentName(meta.agentType)
    }
  } catch { /* no meta file */ }

  // Tier 2: parent session tool_use scan
  const lookupAgentId = (agentId && agentId.trim()) ? agentId.trim() : sidechainAgentIdFromStem(stem)
  if (sessionId && lookupAgentId) {
    const parentPath = findParentSessionPath(filePath, sessionId)
    if (parentPath) {
      const subagentType = lookupSubagentTypeInParent(parentPath, lookupAgentId)
      if (subagentType) return normalizeAgentName(subagentType)
    }
  }

  // Tier 3: fallback
  return normalizeAgentName("claude-code-subagent")
}

function findParentSessionPath(sidechainPath: string, parentSessionId: string): string | null {
  const parentFilename = `${parentSessionId}.jsonl`
  const dir = path.dirname(sidechainPath)
  const dirName = path.basename(dir)

  // Nested layout: .../projects/<key>/<session>/subagents/agent-X.jsonl
  if (dirName === "subagents") {
    const projectDir = path.dirname(path.dirname(dir))
    const candidate = path.join(projectDir, parentFilename)
    if (fs.existsSync(candidate)) return candidate
  }

  // Flat layout: .../projects/<key>/agent-X.jsonl
  const candidate = path.join(dir, parentFilename)
  if (fs.existsSync(candidate)) return candidate

  return null
}

function lookupSubagentTypeInParent(parentPath: string, targetAgentId: string): string | null {
  try {
    const content = fs.readFileSync(parentPath, "utf-8")
    const toolUseTypes = new Map<string, string>()
    const agentIdLinks = new Map<string, string>()

    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const hasSubagentType = trimmed.includes("subagent_type")
      const hasAgentIdText = trimmed.includes("agentId:")
      if (!hasSubagentType && !hasAgentIdText) continue

      try {
        const value = JSON.parse(trimmed)
        const contentArr = value?.message?.content
        if (!Array.isArray(contentArr)) continue

        for (const block of contentArr) {
          if (block.type === "tool_use" && hasSubagentType) {
            const id = block.id as string
            const subagentType = block.input?.subagent_type as string
            if (id && subagentType) toolUseTypes.set(id, subagentType)
          }
          if (block.type === "tool_result" && hasAgentIdText) {
            const toolUseId = block.tool_use_id as string
            if (!toolUseId) continue
            const resultContent = block.content
            if (!Array.isArray(resultContent)) continue
            for (const cb of resultContent) {
              const text = cb.text as string
              if (!text) continue
              const match = text.match(/agentId:\s*([a-zA-Z0-9]+)/)
              if (match) { agentIdLinks.set(toolUseId, match[1]); break }
            }
          }
        }
      } catch { /* skip */ }
    }

    for (const [toolUseId, agentId] of agentIdLinks) {
      if (agentId === targetAgentId) {
        const subagentType = toolUseTypes.get(toolUseId)
        if (subagentType) return subagentType
      }
    }
  } catch { /* skip */ }
  return null
}

interface HeadlessState {
  model: string | null
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  timestampMs: number | null
}

function newHeadlessState(): HeadlessState {
  return { model: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, timestampMs: null }
}

function finalizeHeadless(state: HeadlessState, sessionId: string, fallbackTs: number, workspace: { key?: string; label?: string }): UnifiedMessage | null {
  if (!state.model) return null
  if (state.input + state.output + state.cacheRead + state.cacheWrite === 0) return null
  const ts = state.timestampMs || fallbackTs
  return {
    client: "claude", modelId: state.model, providerId: "anthropic", sessionId,
    workspaceKey: workspace.key, workspaceLabel: workspace.label,
    timestamp: ts, date: timestampToLocalDate(ts),
    tokens: { input: state.input, output: state.output, cacheRead: state.cacheRead, cacheWrite: state.cacheWrite, reasoning: 0 },
    cost: 0, messageCount: 1, isTurnStart: false,
  }
}

function updateHeadlessUsage(state: HeadlessState, usage: Record<string, unknown>) {
  const i = extractI64(usage.input_tokens); if (i > state.input) state.input = i
  const o = extractI64(usage.output_tokens); if (o > state.output) state.output = o
  const cr = extractI64(usage.cache_read_input_tokens); if (cr > state.cacheRead) state.cacheRead = cr
  const cw = extractI64(usage.cache_creation_input_tokens); if (cw > state.cacheWrite) state.cacheWrite = cw
}

function extractHeadlessMessage(obj: Record<string, unknown>, sessionId: string, fallbackTs: number, workspace: { key?: string; label?: string }): UnifiedMessage | null {
  const usage = (obj.usage || (obj.message as Record<string, unknown>)?.usage) as Record<string, unknown> | undefined
  if (!usage) return null
  const model = (obj.model as string) || ((obj.message as Record<string, unknown>)?.model as string)
  if (!model) return null
  const ts = parseTimestamp(obj.timestamp ?? obj.created_at ?? (obj.message as Record<string, unknown>)?.created_at) || fallbackTs
  const input = Math.max(0, extractI64(usage.input_tokens))
  const output = Math.max(0, extractI64(usage.output_tokens))
  const cacheRead = Math.max(0, extractI64(usage.cache_read_input_tokens))
  const cacheWrite = Math.max(0, extractI64(usage.cache_creation_input_tokens))
  if (input + output + cacheRead + cacheWrite === 0) return null
  return {
    client: "claude", modelId: model, providerId: "anthropic", sessionId,
    workspaceKey: workspace.key, workspaceLabel: workspace.label,
    timestamp: ts, date: timestampToLocalDate(ts),
    tokens: { input, output, cacheRead, cacheWrite, reasoning: 0 },
    cost: 0, messageCount: 1, isTurnStart: false,
  }
}

export const claudeParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    // Handle headless JSON files
    if (filePath.endsWith(".json")) {
      return parseHeadlessJson(filePath)
    }

    const dedup = new Map<string, DedupEntry>()
    const fallbackTs = fileModifiedMs(filePath)
    const workspace = extractWorkspace(filePath)
    let sessionId = path.basename(filePath, ".jsonl")
    let pendingTurnStart = false
    let sidechainDetected = false
    let sidechainAgent: string | undefined
    let headlessState = newHeadlessState()

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>
        const entryType = obj.type as string

        // Detect sidechain on first entry
        if (!sidechainDetected) {
          sidechainDetected = true
          if (obj.isSidechain) {
            if (obj.sessionId) sessionId = obj.sessionId as string
            sidechainAgent = resolveSubagentName(filePath, obj.sessionId as string | undefined, obj.agentId as string | undefined)
          }
        }

        if (entryType === "user") {
          if (isHumanTurn(trimmed)) pendingTurnStart = true
          continue
        }

        // Headless streaming events
        if (entryType === "message_start") {
          const completed = finalizeHeadless(headlessState, sessionId, fallbackTs, workspace)
          if (completed) pushToDedup(dedup, completed)
          headlessState = newHeadlessState()
          headlessState.model = (obj.model as string) || ((obj.message as Record<string, unknown>)?.model as string) || null
          headlessState.timestampMs = parseTimestamp(obj.timestamp ?? obj.created_at ?? (obj.message as Record<string, unknown>)?.created_at) || null
          const usage = ((obj.message as Record<string, unknown>)?.usage || obj.usage) as Record<string, unknown> | undefined
          if (usage) updateHeadlessUsage(headlessState, usage)
          continue
        }
        if (entryType === "message_delta") {
          const usage = (obj.usage || (obj.delta as Record<string, unknown>)?.usage) as Record<string, unknown> | undefined
          if (usage) updateHeadlessUsage(headlessState, usage)
          continue
        }
        if (entryType === "message_stop") {
          const completed = finalizeHeadless(headlessState, sessionId, fallbackTs, workspace)
          if (completed) pushToDedup(dedup, completed)
          headlessState = newHeadlessState()
          continue
        }

        if (entryType !== "assistant") {
          // Try as headless single-object
          const hMsg = extractHeadlessMessage(obj, sessionId, fallbackTs, workspace)
          if (hMsg) pushToDedup(dedup, hMsg)
          continue
        }

        // Standard assistant message
        const msg = obj.message as Record<string, unknown> | undefined
        if (!msg?.usage) continue
        const usage = msg.usage as Record<string, unknown>
        const input = Math.max(0, extractI64(usage.input_tokens))
        const output = Math.max(0, extractI64(usage.output_tokens))
        const cacheRead = Math.max(0, extractI64(usage.cache_read_input_tokens))
        const cacheWrite = Math.max(0, extractI64(usage.cache_creation_input_tokens))

        const messageId = (msg.id as string) || ""
        const requestId = (obj.requestId as string) || ""
        const dedupKey = (messageId && requestId) ? `${messageId}:${requestId}` : ""

        if (dedupKey && dedup.has(dedupKey)) {
          const existing = dedup.get(dedupKey)!
          existing.input = Math.max(existing.input, input)
          existing.output = Math.max(existing.output, output)
          existing.cacheRead = Math.max(existing.cacheRead, cacheRead)
          existing.cacheWrite = Math.max(existing.cacheWrite, cacheWrite)
          existing.msg.tokens = { input: existing.input, output: existing.output, cacheRead: existing.cacheRead, cacheWrite: existing.cacheWrite, reasoning: 0 }
          continue
        }

        const ts = parseTimestamp(obj.timestamp) || fallbackTs
        const model = msg.model as string | undefined
        if (!model) continue
        const unified: UnifiedMessage = {
          client: "claude", modelId: model, providerId: "anthropic",
          sessionId, workspaceKey: workspace.key, workspaceLabel: workspace.label,
          timestamp: ts, date: timestampToLocalDate(ts),
          tokens: { input, output, cacheRead, cacheWrite, reasoning: 0 },
          cost: 0, messageCount: 1,
          agent: sidechainAgent,
          dedupKey: dedupKey || undefined,
          isTurnStart: pendingTurnStart,
        }
        pendingTurnStart = false

        const key = dedupKey || `anon-${dedup.size}`
        dedup.set(key, { msg: unified, input, output, cacheRead, cacheWrite })
      } catch { /* skip */ }
    }

    // Finalize any pending headless state
    const lastHeadless = finalizeHeadless(headlessState, sessionId, fallbackTs, workspace)
    if (lastHeadless) pushToDedup(dedup, lastHeadless)

    return Array.from(dedup.values()).map((e) => e.msg)
  },
}

function pushToDedup(dedup: Map<string, DedupEntry>, msg: UnifiedMessage) {
  const key = msg.dedupKey || `anon-${dedup.size}`
  dedup.set(key, { msg, input: msg.tokens.input, output: msg.tokens.output, cacheRead: msg.tokens.cacheRead, cacheWrite: msg.tokens.cacheWrite })
}

function parseHeadlessJson(filePath: string): UnifiedMessage[] {
  const fallbackTs = fileModifiedMs(filePath)
  const workspace = extractWorkspace(filePath)
  const sessionId = path.basename(filePath, ".json")
  const content = fs.readFileSync(filePath, "utf-8")
  try {
    const obj = JSON.parse(content)
    const msg = extractHeadlessMessage(obj, sessionId, fallbackTs, workspace)
    return msg ? [msg] : []
  } catch {
    // Fall through to JSONL parsing
    const results: UnifiedMessage[] = []
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const obj = JSON.parse(trimmed)
        const msg = extractHeadlessMessage(obj, sessionId, fallbackTs, workspace)
        if (msg) results.push(msg)
      } catch { /* skip */ }
    }
    return results
  }
}
