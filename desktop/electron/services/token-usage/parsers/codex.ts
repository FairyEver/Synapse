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

function totalOf(t: CodexTotals): number {
  return t.input + t.output + t.cached + t.reasoning
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

function looksLikeStaleRegression(current: CodexTotals, previous: CodexTotals, last: CodexTotals): boolean {
  const prevTotal = totalOf(previous)
  const curTotal = totalOf(current)
  const lastTotal = totalOf(last)
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

export const codexParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const pendingModelMessages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)
    const sessionId = path.basename(filePath, ".jsonl")

    let currentModel: string | null = null
    let previousTotals: CodexTotals | null = null
    let lastDelta: CodexTotals = { input: 0, output: 0, cached: 0, reasoning: 0 }
    let sessionProvider: string | null = null
    let sessionAgent: string | null = null
    let sessionWorkspaceKey: string | undefined
    let sessionWorkspaceLabel: string | undefined

    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      if (!line.includes("token_count") && !line.includes("turn_context") && !line.includes("session_meta")) continue
      try {
        const obj = JSON.parse(line)
        const payload = obj.payload as Record<string, unknown> | undefined
        if (!payload) continue
        const ts = parseTimestamp(obj.timestamp) || fallbackTs

        if (payload.type === "session_meta" || obj.type === "session_meta") {
          sessionProvider = (payload.provider as string) || null
          sessionAgent = (payload.agent as string) || null
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

        if (payload.type !== "token_count") continue
        const info = payload.info as Record<string, unknown> | undefined
        if (!info) continue
        const totalUsage = info.total_token_usage as Record<string, unknown> | undefined
        if (!totalUsage) continue

        const current: CodexTotals = {
          input: extractI64(totalUsage.input_tokens),
          output: extractI64(totalUsage.output_tokens),
          cached: extractI64(totalUsage.cached_input_tokens),
          reasoning: extractI64(totalUsage.reasoning_output_tokens),
        }

        let delta: CodexTotals
        if (previousTotals) {
          const d = deltaFrom(current, previousTotals)
          if (d) {
            delta = d
          } else if (looksLikeStaleRegression(current, previousTotals, lastDelta)) {
            previousTotals = current
            continue
          } else {
            delta = current
          }
        } else {
          delta = current
        }
        previousTotals = current

        const netInput = Math.max(0, delta.input - delta.cached)
        if (netInput + delta.output === 0) continue
        lastDelta = delta

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
            output: delta.output,
            cacheRead: delta.cached,
            cacheWrite: 0,
            reasoning: delta.reasoning,
          },
          cost: 0,
          messageCount: 1,
          agent: sessionAgent || undefined,
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
