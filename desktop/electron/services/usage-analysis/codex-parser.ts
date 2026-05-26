import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { estimateUsageCost } from "./pricing"
import { localDateKey, localHourKey } from "./range"
import type { ParsedToolEvent, ParsedUsageEvent, ParsedUsageSession, UsageParseOptions } from "./cc-parser"

export interface ParsedTaskEvent {
  readonly id: string
  readonly sessionId: string
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number | null
  readonly timeToFirstTokenMs: number | null
}

export interface ParsedCodexUsageFile {
  readonly sessions: ParsedUsageSession[]
  readonly usageEvents: ParsedUsageEvent[]
  readonly toolEvents: ParsedToolEvent[]
  readonly taskEvents: ParsedTaskEvent[]
  readonly lineCount: number
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

function workspaceFromCwd(cwd: unknown): { key: string; label: string } {
  if (typeof cwd !== "string" || cwd.trim().length === 0) return { key: "", label: "" }
  return { key: cwd, label: path.basename(cwd) || cwd }
}

export async function parseCodexUsageFile(filePath: string, options: UsageParseOptions = {}): Promise<ParsedCodexUsageFile> {
  const fallbackTs = fs.statSync(filePath).mtimeMs
  let sessionId = path.basename(filePath, ".jsonl")
  let workspace = { key: "", label: "" }
  let provider = "openai"
  let source = ""
  let cliVersion = ""
  let currentModel = "unknown"
  let conversationCount = 0
  let startedAt = ""
  let endedAt = ""
  const models = new Set<string>()
  const usageEvents: ParsedUsageEvent[] = []
  const toolEvents: ParsedToolEvent[] = []
  const taskEvents: ParsedTaskEvent[] = []
  let lineCount = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    lineCount += 1
    if (options.startLine && lineCount <= options.startLine) continue
    if (!line.trim()) continue
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const payload = asRecord(raw.payload)
    if (!payload) continue
    const payloadType = typeof payload.type === "string" ? payload.type : String(raw.type ?? "")
    const timestampMs = parseTimestamp(raw.timestamp, fallbackTs)
    const iso = new Date(timestampMs).toISOString()
    if (!startedAt || iso < startedAt) startedAt = iso
    if (!endedAt || iso > endedAt) endedAt = iso

    if (payloadType === "session_meta") {
      if (typeof payload.id === "string") sessionId = payload.id
      workspace = workspaceFromCwd(payload.cwd)
      if (typeof payload.model_provider === "string") provider = payload.model_provider
      if (typeof payload.source === "string") source = payload.source
      if (typeof payload.cli_version === "string") cliVersion = payload.cli_version
      continue
    }

    if (payloadType === "turn_context") {
      if (typeof payload.model === "string") currentModel = payload.model
      models.add(currentModel)
      continue
    }

    if (payloadType === "user_message") {
      conversationCount++
      continue
    }

    if (payloadType === "token_count") {
      const info = asRecord(payload.info)
      const last = asRecord(info?.last_token_usage)
      if (!last) continue
      const cached = asNumber(last.cached_input_tokens)
      const rawInput = asNumber(last.input_tokens)
      const tokens = {
        input: Math.max(0, rawInput - cached),
        output: asNumber(last.output_tokens),
        cacheRead: cached,
        cacheWrite: 0,
        reasoning: asNumber(last.reasoning_output_tokens),
      }
      const cost = estimateUsageCost(currentModel, tokens, options.priceRules)
      usageEvents.push({
        id: `${sessionId}:usage:${usageEvents.length}`,
        sessionId,
        timestampMs,
        date: localDateKey(timestampMs),
        hour: localHourKey(timestampMs),
        workspaceKey: workspace.key,
        workspaceLabel: workspace.label,
        model: currentModel,
        provider,
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
      continue
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const toolName = typeof payload.name === "string" ? payload.name : payloadType
      toolEvents.push({
        id: `${sessionId}:tool:${toolEvents.length}`,
        sessionId,
        timestampMs,
        date: localDateKey(timestampMs),
        hour: localHourKey(timestampMs),
        workspaceKey: workspace.key,
        toolName,
        category: payloadType,
        status: "",
        durationMs: null,
      })
      continue
    }

    if (
      payloadType === "exec_command_end" ||
      payloadType === "patch_apply_end" ||
      payloadType === "web_search_call" ||
      payloadType === "web_search_end" ||
      payloadType === "mcp_tool_call_end"
    ) {
      const exitCode = Number(payload.exit_code)
      toolEvents.push({
        id: `${sessionId}:tool:${toolEvents.length}`,
        sessionId,
        timestampMs,
        date: localDateKey(timestampMs),
        hour: localHourKey(timestampMs),
        workspaceKey: workspace.key,
        toolName: payloadType,
        category: payloadType === "exec_command_end" ? "exec" : payloadType,
        status: typeof payload.status === "string" ? payload.status : "",
        durationMs: asNumber(payload.duration || payload.duration_ms) || null,
        exitCode: Number.isFinite(exitCode) ? exitCode : null,
      })
      continue
    }

    if (payloadType === "task_complete") {
      taskEvents.push({
        id: typeof payload.turn_id === "string" ? payload.turn_id : `${sessionId}:task:${taskEvents.length}`,
        sessionId,
        startedAt: typeof payload.started_at === "string" ? payload.started_at : "",
        completedAt: typeof payload.completed_at === "string" ? payload.completed_at : iso,
        durationMs: asNumber(payload.duration_ms) || null,
        timeToFirstTokenMs: asNumber(payload.time_to_first_token_ms) || null,
      })
    }
  }

  return {
    sessions: [{
      sessionId,
      filePath,
      workspaceKey: workspace.key,
      workspaceLabel: workspace.label,
      provider,
      source,
      cliVersion,
      startedAt,
      endedAt,
      modelSummary: [...models].join(", "),
      requestCount: usageEvents.length,
      conversationCount,
      toolCallCount: toolEvents.length,
    }],
    usageEvents,
    toolEvents,
    taskEvents,
    lineCount,
  }
}
