import fs from "node:fs"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

const DEFAULT_MODEL = "codebuff-unknown"

interface AssistantUsage {
  model: string | null
  credits: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

function newUsage(): AssistantUsage {
  return { model: null, credits: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function hasSignal(u: AssistantUsage): boolean {
  return u.input > 0 || u.output > 0 || u.cacheRead > 0 || u.cacheWrite > 0 || u.credits > 0
}

function mergeFallback(base: AssistantUsage, other: AssistantUsage): void {
  if (base.input <= 0) base.input = other.input
  if (base.output <= 0) base.output = other.output
  if (base.cacheRead <= 0) base.cacheRead = other.cacheRead
  if (base.cacheWrite <= 0) base.cacheWrite = other.cacheWrite
  if (!base.model) base.model = other.model
  if (base.credits <= 0) base.credits = other.credits
}

function parseUsageObject(obj: Record<string, unknown>): AssistantUsage {
  const u = newUsage()
  u.input = pickNumber(obj, "inputTokens", "input_tokens", "promptTokens", "prompt_tokens")
  u.output = pickNumber(obj, "outputTokens", "output_tokens", "completionTokens", "completion_tokens")
  u.cacheRead = pickNumber(obj, "cacheReadInputTokens", "cache_read_input_tokens", "cachedTokensCreated", "cached_tokens_created")
    || pickNestedCached(obj)
  u.cacheWrite = pickNumber(obj, "cacheCreationInputTokens", "cache_creation_input_tokens", "cacheCreationTokens", "cache_creation_tokens")
  if (typeof obj.credits === "number") u.credits = obj.credits as number
  if (typeof obj.model === "string") u.model = obj.model as string
  return u
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "number" && v > 0) return v
  }
  return 0
}

function pickNestedCached(obj: Record<string, unknown>): number {
  const details = (obj.promptTokensDetails ?? obj.prompt_tokens_details) as Record<string, unknown> | undefined
  if (!details) return 0
  const v = details.cachedTokens ?? details.cached_tokens
  return typeof v === "number" && v > 0 ? v : 0
}

function deriveContext(filePath: string): { channel: string; project: string; chatId: string } {
  const chatDir = path.dirname(filePath)
  const chatId = path.basename(chatDir) || "unknown"
  const chatsDir = path.dirname(chatDir)
  const projectDir = path.dirname(chatsDir)
  const project = path.basename(projectDir) || "unknown"
  const channelDir = path.dirname(path.dirname(projectDir))
  const channel = path.basename(channelDir) || "manicode"
  return { channel, project, chatId }
}

function parseChatIdToMillis(chatId: string): number | null {
  const tIdx = chatId.indexOf("T")
  if (tIdx < 0) return null
  const datePart = chatId.slice(0, tIdx)
  const timePart = chatId.slice(tIdx)
  let count = 0
  const rebuilt = datePart + timePart.replace(/-/g, (m) => {
    count++
    return count <= 2 ? ":" : m
  })
  const ts = parseTimestamp(rebuilt)
  return ts && ts > 0 ? ts : null
}

function extractAssistantUsage(entry: Record<string, unknown>): AssistantUsage {
  const metadata = entry.metadata as Record<string, unknown> | undefined
  const usage = newUsage()

  if (metadata) {
    if (typeof metadata.model === "string") usage.model = metadata.model as string
    const p1 = metadata.usage as Record<string, unknown> | undefined
    if (p1) mergeFallback(usage, parseUsageObject(p1))
    const codebuff = metadata.codebuff as Record<string, unknown> | undefined
    const p2 = codebuff?.usage as Record<string, unknown> | undefined
    if (p2) mergeFallback(usage, parseUsageObject(p2))
    const runStateUsage = extractUsageFromRunState(metadata)
    if (runStateUsage) mergeFallback(usage, runStateUsage)
  }

  if (typeof entry.credits === "number" && (entry.credits as number) > 0 && usage.credits <= 0) {
    usage.credits = entry.credits as number
  }

  return usage
}

function extractUsageFromRunState(metadata: Record<string, unknown>): AssistantUsage | null {
  const runState = metadata.runState as Record<string, unknown> | undefined
  const sessionState = runState?.sessionState as Record<string, unknown> | undefined
  const mainAgent = sessionState?.mainAgentState as Record<string, unknown> | undefined
  const history = mainAgent?.messageHistory as Record<string, unknown>[] | undefined
  if (!Array.isArray(history)) return null

  const accumulator = newUsage()
  let foundAny = false

  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]
    const role = (h.role as string) || ""
    if (role !== "assistant") continue

    const po = h.providerOptions as Record<string, unknown> | undefined
    if (!po) continue

    const entryUsage = newUsage()
    const poUsage = po.usage as Record<string, unknown> | undefined
    if (poUsage) mergeFallback(entryUsage, parseUsageObject(poUsage))
    const poCb = po.codebuff as Record<string, unknown> | undefined
    const poCbUsage = poCb?.usage as Record<string, unknown> | undefined
    if (poCbUsage) mergeFallback(entryUsage, parseUsageObject(poCbUsage))
    if (typeof poCb?.model === "string") entryUsage.model = poCb.model as string

    if (hasSignal(entryUsage) || entryUsage.model) foundAny = true
    mergeFallback(accumulator, entryUsage)
  }

  return foundAny ? accumulator : null
}

function messageTimestamp(entry: Record<string, unknown>): number | null {
  for (const key of ["timestamp", "createdAt"]) {
    const ts = parseTimestamp(entry[key])
    if (ts) return ts
  }
  const metadata = entry.metadata as Record<string, unknown> | undefined
  if (metadata?.timestamp) return parseTimestamp(metadata.timestamp) || null
  return null
}

function deriveDedupKey(sessionId: string, ts: number, model: string, usage: AssistantUsage, ordinal: number): string {
  return `codebuff:${sessionId}:${ts}:${model}:${ordinal}:${Math.max(0, usage.input)}:${Math.max(0, usage.output)}:${Math.max(0, usage.cacheRead)}:${Math.max(0, usage.cacheWrite)}`
}

function inferProvider(model: string): string {
  if (!model) return "unknown"
  const m = model.toLowerCase()
  if (m.includes("claude")) return "anthropic"
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai"
  if (m.includes("gemini")) return "google"
  if (m.includes("deepseek")) return "deepseek"
  return "unknown"
}

export const codebuffParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const messages: UnifiedMessage[] = []
    const fallbackTs = fileModifiedMs(filePath)

    try {
      const entries = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      if (!Array.isArray(entries)) return messages

      const { channel, project, chatId } = deriveContext(filePath)
      const sessionId = `${channel}/${project}/${chatId}`
      const chatIdTs = parseChatIdToMillis(chatId)

      for (let ordinal = 0; ordinal < entries.length; ordinal++) {
        const entry = entries[ordinal] as Record<string, unknown>
        const variant = (entry.variant as string) || (entry.role as string) || ""
        if (variant !== "ai" && variant !== "agent" && variant !== "assistant") continue

        const usage = extractAssistantUsage(entry)
        if (!hasSignal(usage)) continue

        const ts = messageTimestamp(entry) ?? chatIdTs ?? fallbackTs
        const model = usage.model || DEFAULT_MODEL
        const provider = inferProvider(model)

        const upstreamId = (typeof entry.id === "string" && (entry.id as string)) || ""
        const dedupKey = upstreamId || deriveDedupKey(sessionId, ts, model, usage, ordinal)

        messages.push({
          client: "codebuff",
          modelId: model,
          providerId: provider,
          sessionId,
          timestamp: ts,
          date: timestampToLocalDate(ts),
          tokens: {
            input: Math.max(0, usage.input),
            output: Math.max(0, usage.output),
            cacheRead: Math.max(0, usage.cacheRead),
            cacheWrite: Math.max(0, usage.cacheWrite),
            reasoning: 0,
          },
          cost: Math.max(0, usage.credits),
          dedupKey,
          messageCount: 1,
          isTurnStart: false,
        })
      }
    } catch { /* skip */ }

    return messages
  },
}
