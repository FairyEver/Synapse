import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

interface CodexTotals {
  input: number
  output: number
  cached: number
  reasoning: number
}

function totalsEqual(a: CodexTotals, b: CodexTotals): boolean {
  return a.input === b.input && a.output === b.output
    && a.cached === b.cached && a.reasoning === b.reasoning
}

function deltaFrom(current: CodexTotals, previous: CodexTotals): CodexTotals | null {
  if (current.input < previous.input || current.output < previous.output
    || current.cached < previous.cached || current.reasoning < previous.reasoning) {
    return null
  }
  return {
    input: current.input - previous.input,
    output: current.output - previous.output,
    cached: current.cached - previous.cached,
    reasoning: current.reasoning - previous.reasoning,
  }
}

function saturatingAdd(base: CodexTotals, inc: CodexTotals): CodexTotals {
  return {
    input: base.input + inc.input,
    output: base.output + inc.output,
    cached: base.cached + inc.cached,
    reasoning: base.reasoning + inc.reasoning,
  }
}

function looksLikeStaleRegression(current: CodexTotals, previous: CodexTotals, last: CodexTotals): boolean {
  const prevTotal = previous.input + previous.output + previous.cached + previous.reasoning
  const curTotal = current.input + current.output + current.cached + current.reasoning
  const lastTotal = last.input + last.output + last.cached + last.reasoning
  if (prevTotal <= 0 || curTotal <= 0 || lastTotal <= 0) return false
  return (curTotal * 100 >= prevTotal * 98) || (curTotal + lastTotal * 2 >= prevTotal)
}

function extractModel(payload: Record<string, unknown>): string | null {
  const info = payload.model_info as Record<string, unknown> | undefined
  if (info?.slug && typeof info.slug === "string") return info.slug
  if (typeof payload.model === "string" && payload.model) return payload.model
  if (typeof payload.model_name === "string" && payload.model_name) return payload.model_name
  const infoObj = payload.info as Record<string, unknown> | undefined
  if (typeof infoObj?.model === "string" && infoObj.model) return infoObj.model as string
  if (typeof infoObj?.model_name === "string" && infoObj.model_name) return infoObj.model_name as string
  return null
}

function extractModelFromInfo(info: Record<string, unknown>): string | null {
  if (typeof info.model === "string" && info.model) return info.model
  if (typeof info.model_name === "string" && info.model_name) return info.model_name
  return null
}

function tryExtractHeadlessUsage(
  obj: Record<string, unknown>, sessionId: string, ts: number,
  currentModel: string | null, provider: string | null,
  workspaceKey: string | undefined, workspaceLabel: string | undefined,
  agent: string | undefined,
): UnifiedMessage | null {
  const usage = findNestedUsage(obj)
  if (!usage) return null
  const input = Math.max(0, extractI64(usage.input_tokens))
  const output = Math.max(0, extractI64(usage.output_tokens))
  const cached = Math.max(
    Math.max(0, extractI64(usage.cached_input_tokens)),
    Math.max(0, extractI64(usage.cache_read_input_tokens)),
  )
  const reasoning = Math.max(0, extractI64(usage.reasoning_output_tokens))
  if (input + output + cached + reasoning === 0) return null
  const clampedCached = Math.min(cached, input)
  const netInput = Math.max(0, input - clampedCached)
  return {
    client: "codex", modelId: currentModel || "unknown",
    providerId: provider || "openai", sessionId,
    workspaceKey, workspaceLabel,
    timestamp: ts, date: timestampToLocalDate(ts),
    tokens: { input: netInput, output, cacheRead: clampedCached, cacheWrite: 0, reasoning },
    cost: 0, messageCount: 1, agent, isTurnStart: false,
  }
}

function findNestedUsage(obj: Record<string, unknown>): Record<string, unknown> | null {
  if (obj.usage && typeof obj.usage === "object") return obj.usage as Record<string, unknown>
  const data = obj.data as Record<string, unknown> | undefined
  if (data?.usage && typeof data.usage === "object") return data.usage as Record<string, unknown>
  const result = obj.result as Record<string, unknown> | undefined
  if (result?.usage && typeof result.usage === "object") return result.usage as Record<string, unknown>
  const response = obj.response as Record<string, unknown> | undefined
  if (response?.usage && typeof response.usage === "object") return response.usage as Record<string, unknown>
  return null
}

export const codexParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const pendingModelMessages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)
    const sessionId = path.basename(filePath, ".jsonl")

    let currentModel: string | null = null
    let previousTotals: CodexTotals | null = null
    let sessionProvider: string | null = null
    let sessionAgent: string | null = null
    let sessionIsHeadless = false
    let sessionWorkspaceKey: string | undefined
    let sessionWorkspaceLabel: string | undefined

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.includes("token_count") && !line.includes("turn_context") && !line.includes("session_meta") && !line.includes("usage")) continue
      try {
        const obj = JSON.parse(line)
        const payload = obj.payload as Record<string, unknown> | undefined
        if (!payload) continue
        const ts = parseTimestamp(obj.timestamp) || fallbackTs

        if (payload.type === "session_meta" || obj.type === "session_meta") {
          sessionProvider = (payload.model_provider as string) || null
          sessionAgent = (payload.agent_nickname as string) || null
          if (payload.source === "exec") sessionIsHeadless = true
          const cwd = payload.cwd as string | undefined
          if (cwd) {
            sessionWorkspaceKey = cwd
            sessionWorkspaceLabel = path.basename(cwd)
          }
          continue
        }

        if (obj.type === "turn_context" || payload.type === "turn_context") {
          const model = extractModel(payload)
          if (model) {
            currentModel = model
            for (const pending of pendingModelMessages) {
              pending.modelId = model
            }
            messages.push(...pendingModelMessages)
            pendingModelMessages.length = 0
          }
          continue
        }

        if (payload.type !== "token_count") {
          // Headless fallback: try to extract usage from any line with usage data
          const headlessMsg = tryExtractHeadlessUsage(obj, sessionId, ts, currentModel, sessionProvider, sessionWorkspaceKey, sessionWorkspaceLabel, sessionIsHeadless ? "headless" : sessionAgent || undefined)
          if (headlessMsg) messages.push(headlessMsg)
          continue
        }
        const info = payload.info as Record<string, unknown> | undefined
        if (!info) continue

        // Extract model from token_count event if available
        const tcModel = extractModel(payload) || extractModelFromInfo(info)
        if (tcModel && !currentModel) currentModel = tcModel

        const totalUsageRaw = info.total_token_usage as Record<string, unknown> | undefined
        const lastUsageRaw = info.last_token_usage as Record<string, unknown> | undefined

        const totalUsage: CodexTotals | null = totalUsageRaw ? {
          input: Math.max(0, extractI64(totalUsageRaw.input_tokens)),
          output: Math.max(0, extractI64(totalUsageRaw.output_tokens)),
          cached: Math.max(
            Math.max(0, extractI64(totalUsageRaw.cached_input_tokens)),
            Math.max(0, extractI64(totalUsageRaw.cache_read_input_tokens)),
          ),
          reasoning: Math.max(0, extractI64(totalUsageRaw.reasoning_output_tokens)),
        } : null

        const lastUsage: CodexTotals | null = lastUsageRaw ? {
          input: Math.max(0, extractI64(lastUsageRaw.input_tokens)),
          output: Math.max(0, extractI64(lastUsageRaw.output_tokens)),
          cached: Math.max(
            Math.max(0, extractI64(lastUsageRaw.cached_input_tokens)),
            Math.max(0, extractI64(lastUsageRaw.cache_read_input_tokens)),
          ),
          reasoning: Math.max(0, extractI64(lastUsageRaw.reasoning_output_tokens)),
        } : null

        let tokens: CodexTotals | null = null
        let nextTotals: CodexTotals | null = null

        if (totalUsage && lastUsage && previousTotals) {
          if (totalsEqual(totalUsage, previousTotals)) continue
          if (deltaFrom(totalUsage, previousTotals) === null
            && looksLikeStaleRegression(totalUsage, previousTotals, lastUsage)) {
            continue
          }
          tokens = lastUsage
          nextTotals = totalUsage
        } else if (totalUsage && lastUsage && !previousTotals) {
          tokens = lastUsage
          nextTotals = totalUsage
        } else if (totalUsage && !lastUsage && previousTotals) {
          if (totalsEqual(totalUsage, previousTotals)) continue
          const d = deltaFrom(totalUsage, previousTotals)
          if (d) {
            tokens = d
            nextTotals = totalUsage
          } else {
            previousTotals = totalUsage
            continue
          }
        } else if (totalUsage && !lastUsage && !previousTotals) {
          tokens = totalUsage
          nextTotals = totalUsage
        } else if (!totalUsage && lastUsage && previousTotals) {
          tokens = lastUsage
          nextTotals = saturatingAdd(previousTotals, lastUsage)
        } else if (!totalUsage && lastUsage && !previousTotals) {
          tokens = lastUsage
          nextTotals = null
        } else {
          continue
        }

        if (!tokens || (tokens.input === 0 && tokens.output === 0 && tokens.cached === 0 && tokens.reasoning === 0)) {
          continue
        }

        if (nextTotals) previousTotals = nextTotals

        const clampedCached = Math.min(tokens.cached, tokens.input)
        const netInput = Math.max(0, tokens.input - clampedCached)

        const unified: UnifiedMessage = {
          client: "codex",
          modelId: currentModel || "unknown",
          providerId: sessionProvider || "openai",
          sessionId,
          workspaceKey: sessionWorkspaceKey,
          workspaceLabel: sessionWorkspaceLabel,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: {
            input: netInput,
            output: tokens.output,
            cacheRead: clampedCached,
            cacheWrite: 0,
            reasoning: tokens.reasoning,
          },
          cost: 0,
          messageCount: 1,
          agent: sessionIsHeadless ? "headless" : sessionAgent || undefined,
          isTurnStart: false,
        }

        if (currentModel) {
          messages.push(unified)
        } else {
          pendingModelMessages.push(unified)
        }
      } catch {
        // skip malformed lines
      }
    }

    for (const pending of pendingModelMessages) {
      pending.modelId = "unknown"
      messages.push(pending)
    }

    return messages
  },
}
