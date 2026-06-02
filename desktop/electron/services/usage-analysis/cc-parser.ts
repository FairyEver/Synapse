import fs from "node:fs"
import path from "node:path"
import { estimateUsageCost, type UsageModelPriceRule } from "./pricing"
import { localDateKey, localHourKey } from "./range"
import { CC_RECENT_DEDUPE_KEYS_LIMIT } from "./cc-scan-state"

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
  readonly priceKnown: boolean
}

export interface ParsedToolEvent {
  readonly id: string
  readonly sessionId: string
  readonly timestampMs: number
  readonly date: string
  readonly hour: string
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
  readonly lineCount: number
}

export interface UsageParseOptions {
  readonly startLine?: number
  readonly priceRules?: readonly UsageModelPriceRule[]
}

export type ClaudeUsageParseMode = "append" | "replace"

export interface ClaudeUsageParserState {
  readonly recentDedupeKeys: readonly string[]
}

export interface ClaudeUsageSegmentParseOptions extends UsageParseOptions {
  readonly filePath: string
  readonly startOffset: number
  readonly mode: ClaudeUsageParseMode
  readonly previousState?: ClaudeUsageParserState
}

export interface ParsedUsageSegment extends ParsedUsageFile {
  readonly nextOffset: number
  readonly affectedDates: string[]
  readonly affectedHours: string[]
  readonly parserState: ClaudeUsageParserState
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
  const label = key ? key.replace(/^-Users-/, "/Users/") : ""
  return { key, label }
}

function workspaceLabelFromCwd(cwd: unknown): string {
  return typeof cwd === "string" && cwd.trim().length > 0 ? cwd.trim().replaceAll("\\", "/") : ""
}

function extractReasoningTokens(content: unknown[]): number {
  return content.reduce<number>((total, item) => {
    const block = asRecord(item)
    if (!block || block.type !== "thinking") return total
    return total + asNumber(block.tokens)
  }, 0)
}

async function readCompleteJsonlLines(
  filePath: string,
  startOffset: number,
  onLine: (line: string, lineStartOffset: number, lineEndOffset: number) => boolean | void,
): Promise<number> {
  let pending = Buffer.alloc(0)
  let bufferStartOffset = startOffset
  const stream = fs.createReadStream(filePath, { start: startOffset })

  for await (const chunk of stream) {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const buffer = pending.length > 0 ? Buffer.concat([pending, chunkBuffer]) : chunkBuffer
    let lineStart = 0

    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 10) continue
      const rawLine = buffer.subarray(lineStart, index)
      const line = rawLine.at(-1) === 13 ? rawLine.subarray(0, -1).toString("utf8") : rawLine.toString("utf8")
      onLine(line, bufferStartOffset + lineStart, bufferStartOffset + index + 1)
      lineStart = index + 1
    }

    pending = buffer.subarray(lineStart)
    bufferStartOffset += lineStart
  }

  if (pending.length > 0) {
    const line = pending.at(-1) === 13 ? pending.subarray(0, -1).toString("utf8") : pending.toString("utf8")
    const consumed = onLine(line, bufferStartOffset, bufferStartOffset + pending.length)
    if (consumed !== false) return bufferStartOffset + pending.length
  }

  return bufferStartOffset
}

function shouldParseClaudeLine(line: string): boolean {
  return line.includes('"type":"assistant"') ||
    line.includes('"type": "assistant"') ||
    line.includes('"type":"user"') ||
    line.includes('"type": "user"')
}

function shouldParseClaudeAssistantLine(line: string): boolean {
  return line.includes('"type":"assistant"') || line.includes('"type": "assistant"')
}

function makeClaudeDedupeState(seed: readonly string[] = []): { insert: (key: string) => boolean; snapshot: () => string[] } {
  const seen = new Set<string>()
  const order: string[] = []
  const insert = (key: string) => {
    if (seen.has(key)) return false
    seen.add(key)
    order.push(key)
    while (order.length > CC_RECENT_DEDUPE_KEYS_LIMIT) {
      const old = order.shift()
      if (old) seen.delete(old)
    }
    return true
  }
  seed.forEach(insert)
  return { insert, snapshot: () => [...order] }
}

export async function parseClaudeUsageFile(filePath: string, options: UsageParseOptions = {}): Promise<ParsedUsageFile> {
  return parseClaudeUsageFileSegment({
    filePath,
    startOffset: 0,
    mode: "replace",
    priceRules: options.priceRules,
  })
}

export async function parseClaudeUsageFileSegment(options: ClaudeUsageSegmentParseOptions): Promise<ParsedUsageSegment> {
  const fallbackTs = fs.statSync(options.filePath).mtimeMs
  const fallbackSessionId = path.basename(options.filePath, ".jsonl")
  let workspace = workspaceFromClaudePath(options.filePath)
  const usageEvents = new Map<string, ParsedUsageEvent>()
  const toolEvents = new Map<string, ParsedToolEvent>()
  const sessionIds = new Set<string>()
  const models = new Set<string>()
  const affectedDates = new Set<string>()
  const affectedHours = new Set<string>()
  const dedupe = makeClaudeDedupeState(options.previousState?.recentDedupeKeys)
  let conversationCount = 0
  let startedAt = ""
  let endedAt = ""
  let lineCount = 0

  const nextOffset = await readCompleteJsonlLines(options.filePath, options.startOffset, (line, lineStartOffset) => {
    lineCount += 1
    if (!line.trim() || !shouldParseClaudeLine(line)) return true

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(line) as Record<string, unknown>
    } catch {
      return false
    }

    const cwdLabel = workspaceLabelFromCwd(raw.cwd)
    if (cwdLabel) workspace = { key: workspace.key || cwdLabel, label: cwdLabel }

    const timestampMs = parseTimestamp(raw.timestamp, fallbackTs)
    const iso = new Date(timestampMs).toISOString()
    const sessionId = typeof raw.sessionId === "string" && raw.sessionId ? raw.sessionId : fallbackSessionId
    sessionIds.add(sessionId)
    if (!startedAt || iso < startedAt) startedAt = iso
    if (!endedAt || iso > endedAt) endedAt = iso

    if (raw.type === "user") {
      conversationCount++
      return true
    }
    if (!shouldParseClaudeAssistantLine(line)) return true

    const message = asRecord(raw.message)
    if (!message) return true

    const content = Array.isArray(message.content) ? message.content : []
    const messageId = typeof message.id === "string" && message.id ? message.id : ""
    const requestId = typeof raw.requestId === "string" ? raw.requestId : typeof raw.request_id === "string" ? raw.request_id : ""
    if (messageId && requestId && !dedupe.insert(`${messageId}:${requestId}`)) return true

    content.forEach((block, index) => {
      const value = asRecord(block)
      if (value?.type !== "tool_use") return
      const toolName = typeof value.name === "string" ? value.name : "unknown"
      const blockId = typeof value.id === "string" && value.id ? value.id : String(index)
      const idBase = messageId || `offset-${lineStartOffset}`
      const id = `${sessionId}:tool:${idBase}:${blockId}`
      const date = localDateKey(timestampMs)
      const hour = localHourKey(timestampMs)
      affectedDates.add(date)
      affectedHours.add(hour)
      toolEvents.set(id, {
        id,
        sessionId,
        timestampMs,
        date,
        hour,
        workspaceKey: workspace.key,
        toolName,
        category: "tool_use",
        status: "",
        durationMs: null,
      })
    })

    const usage = asRecord(message.usage)
    const model = typeof message.model === "string" ? message.model : ""
    if (!usage || !model) return true
    models.add(model)

    const tokens = {
      input: asNumber(usage.input_tokens),
      output: asNumber(usage.output_tokens),
      cacheRead: asNumber(usage.cache_read_input_tokens),
      cacheWrite: asNumber(usage.cache_creation_input_tokens),
      reasoning: extractReasoningTokens(content),
    }
    if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning <= 0) return true

    const date = localDateKey(timestampMs)
    const hour = localHourKey(timestampMs)
    const cost = estimateUsageCost(model, tokens, options.priceRules)
    const eventId = `${sessionId}:usage:${messageId || `offset-${lineStartOffset}`}`
    affectedDates.add(date)
    affectedHours.add(hour)
    usageEvents.set(eventId, {
      id: eventId,
      sessionId,
      timestampMs,
      date,
      hour,
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
      priceKnown: cost.priceKnown,
    })
    return true
  })

  const usageRows = [...usageEvents.values()]
  const toolRows = [...toolEvents.values()]
  if (sessionIds.size === 0 && options.mode === "replace") sessionIds.add(fallbackSessionId)

  return {
    sessions: [...sessionIds].map((sessionId) => ({
      sessionId,
      filePath: options.filePath,
      workspaceKey: workspace.key,
      workspaceLabel: workspace.label,
      provider: "anthropic",
      source: "claude-code",
      cliVersion: "",
      startedAt,
      endedAt,
      modelSummary: [...models].join(", "),
      requestCount: usageRows.filter((event) => event.sessionId === sessionId).length,
      conversationCount,
      toolCallCount: toolRows.filter((event) => event.sessionId === sessionId).length,
    })),
    usageEvents: usageRows,
    toolEvents: toolRows,
    lineCount,
    nextOffset,
    affectedDates: [...affectedDates].sort(),
    affectedHours: [...affectedHours].sort(),
    parserState: { recentDedupeKeys: dedupe.snapshot() },
  }
}
