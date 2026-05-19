import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { estimateUsageCost } from "./pricing"
import { localDateKey, localHourKey } from "./range"

export interface ParsedUsageSession {
  readonly sessionId: string
  readonly filePath: string
  readonly workspaceKey: string
  readonly workspaceLabel: string
  readonly provider: string
  readonly source: string
  readonly cliVersion: string
  readonly startedAt: string
  readonly endedAt: string
  readonly modelSummary: string
  readonly requestCount: number
  readonly conversationCount: number
  readonly toolCallCount: number
}

export interface ParsedUsageEvent {
  readonly id: string
  readonly sessionId: string
  readonly timestampMs: number
  readonly date: string
  readonly hour: string
  readonly workspaceKey: string
  readonly workspaceLabel: string
  readonly model: string
  readonly provider: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly costInput: number
  readonly costOutput: number
  readonly costCacheRead: number
  readonly costCacheWrite: number
  readonly costReasoning: number
  readonly totalCost: number
}

export interface ParsedToolEvent {
  readonly id: string
  readonly sessionId: string
  readonly timestampMs: number
  readonly date: string
  readonly workspaceKey: string
  readonly toolName: string
  readonly category: string
  readonly status: string
  readonly durationMs: number | null
  readonly exitCode?: number | null
}

export interface ParsedUsageFile {
  readonly sessions: ParsedUsageSession[]
  readonly usageEvents: ParsedUsageEvent[]
  readonly toolEvents: ParsedToolEvent[]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined
}

function asNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0
}

function parseTimestamp(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function workspaceFromClaudePath(filePath: string): { key: string; label: string } {
  const parts = filePath.split(path.sep)
  const projectIndex = parts.findIndex((part, index) => part === ".claude" && parts[index + 1] === "projects")
  const key = projectIndex >= 0 ? (parts[projectIndex + 2] ?? "") : ""
  const label = key ? key.replace(/^-Users-/, "/Users/").replaceAll("-", "/") : ""
  return { key, label }
}

function extractReasoningTokens(content: unknown[]): number {
  return content.reduce((total, item) => {
    const block = asRecord(item)
    if (!block || block.type !== "thinking") return total
    return total + asNumber(block.tokens)
  }, 0)
}

export async function parseClaudeUsageFile(filePath: string): Promise<ParsedUsageFile> {
  const fallbackTs = fs.statSync(filePath).mtimeMs
  const sessionId = path.basename(filePath, ".jsonl")
  const workspace = workspaceFromClaudePath(filePath)
  const usageEvents: ParsedUsageEvent[] = []
  const toolEvents: ParsedToolEvent[] = []
  const models = new Set<string>()
  let conversationCount = 0
  let startedAt = ""
  let endedAt = ""

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const timestampMs = parseTimestamp(raw.timestamp, fallbackTs)
    const iso = new Date(timestampMs).toISOString()
    if (!startedAt || iso < startedAt) startedAt = iso
    if (!endedAt || iso > endedAt) endedAt = iso

    if (raw.type === "user") {
      conversationCount++
      continue
    }

    const message = asRecord(raw.message)
    if (!message) continue

    const content = Array.isArray(message.content) ? message.content : []
    for (const block of content) {
      const value = asRecord(block)
      if (value?.type !== "tool_use") continue
      const toolName = typeof value.name === "string" ? value.name : "unknown"
      toolEvents.push({
        id: `${sessionId}:tool:${toolEvents.length}`,
        sessionId,
        timestampMs,
        date: localDateKey(timestampMs),
        workspaceKey: workspace.key,
        toolName,
        category: "tool_use",
        status: "",
        durationMs: null,
      })
    }

    const usage = asRecord(message.usage)
    const model = typeof message.model === "string" ? message.model : ""
    if (!usage || !model) continue
    models.add(model)

    const tokens = {
      input: asNumber(usage.input_tokens),
      output: asNumber(usage.output_tokens),
      cacheRead: asNumber(usage.cache_read_input_tokens),
      cacheWrite: asNumber(usage.cache_creation_input_tokens),
      reasoning: extractReasoningTokens(content),
    }
    const cost = estimateUsageCost("cc", model, tokens)
    usageEvents.push({
      id: `${sessionId}:usage:${usageEvents.length}`,
      sessionId,
      timestampMs,
      date: localDateKey(timestampMs),
      hour: localHourKey(timestampMs),
      workspaceKey: workspace.key,
      workspaceLabel: workspace.label,
      model,
      provider: "anthropic",
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: tokens.cacheRead,
      cacheWriteTokens: tokens.cacheWrite,
      reasoningTokens: tokens.reasoning,
      costInput: cost.input,
      costOutput: cost.output,
      costCacheRead: cost.cacheRead,
      costCacheWrite: cost.cacheWrite,
      costReasoning: cost.reasoning,
      totalCost: cost.total,
    })
  }

  return {
    sessions: [{
      sessionId,
      filePath,
      workspaceKey: workspace.key,
      workspaceLabel: workspace.label,
      provider: "anthropic",
      source: "claude-code",
      cliVersion: "",
      startedAt,
      endedAt,
      modelSummary: [...models].join(", "),
      requestCount: usageEvents.length,
      conversationCount,
      toolCallCount: toolEvents.length,
    }],
    usageEvents,
    toolEvents,
  }
}
