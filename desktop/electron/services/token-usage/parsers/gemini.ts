import fs from "node:fs"
import readline from "node:readline"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

function tryNum(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = extractI64(obj[k])
    if (v > 0) return v
  }
  return 0
}

function subtractCachedOverlap(input: number, cached: number): [number, number] {
  const i = Math.max(0, input)
  const c = Math.max(0, cached)
  const portion = Math.min(c, i)
  return [i - portion, c]
}

function normalizeHeadlessInputAndCache(input: number, cached: number): [number, number] {
  return subtractCachedOverlap(input, cached)
}

function normalizeSessionInputAndCache(
  input: number, cached: number, output: number, reasoning: number, tool: number, total: number | null,
): [number, number] {
  const i = Math.max(0, input)
  const c = Math.max(0, cached)
  if (total === null || total === undefined) return [i, c]
  const t = Math.max(0, total)
  const inclusiveTotal = i + Math.max(0, output) + Math.max(0, reasoning) + Math.max(0, tool)
  const exclusiveTotal = inclusiveTotal + c
  if (c > 0 && t === inclusiveTotal && t !== exclusiveTotal) {
    return subtractCachedOverlap(i, c)
  }
  return [i, c]
}

function extractTimestampFromObj(obj: Record<string, unknown>): number | null {
  return parseTimestamp(obj.timestamp ?? obj.created_at) || null
}

function parseSessionJson(filePath: string, fallbackTs: number): UnifiedMessage[] {
  const messages: UnifiedMessage[] = []
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    const msgs = data.messages as Record<string, unknown>[] | undefined
    if (!Array.isArray(msgs)) return parseHeadlessJson(data, filePath, fallbackTs)

    const sessionId = (data.sessionId as string) || path.basename(filePath, ".json")

    for (const msg of msgs) {
      if ((msg.type as string) !== "gemini") continue
      const tokens = msg.tokens as Record<string, unknown> | undefined
      if (!tokens) continue
      const model = (msg.model as string)
      if (!model) continue

      const rawInput = extractI64(tokens.input)
      const rawCached = extractI64(tokens.cached)
      const output = Math.max(0, extractI64(tokens.output))
      const reasoning = Math.max(0, extractI64(tokens.thoughts))
      const tool = Math.max(0, extractI64(tokens.tool))
      const total = tokens.total !== undefined ? extractI64(tokens.total) : null

      const [input, cacheRead] = normalizeSessionInputAndCache(rawInput, rawCached, output, reasoning, tool, total)
      if (input + output + cacheRead + reasoning === 0) continue

      const ts = parseTimestamp(msg.timestamp) || fallbackTs
      messages.push({
        client: "gemini", modelId: model, providerId: "google",
        sessionId, timestamp: ts, date: timestampToLocalDate(ts),
        tokens: { input, output, cacheRead, cacheWrite: 0, reasoning },
        cost: 0, messageCount: 1, isTurnStart: false,
      })
    }
  } catch { /* skip */ }
  return messages
}

function parseHeadlessJson(data: Record<string, unknown>, filePath: string, fallbackTs: number): UnifiedMessage[] {
  if ((data.type as string) === "gemini") {
    const msg = parseDirectGeminiMessage(data, undefined, path.basename(filePath, ".json"), fallbackTs)
    return msg ? [msg] : []
  }

  const stats = (data.stats ?? (data.result as Record<string, unknown>)?.stats) as Record<string, unknown> | undefined
  if (!stats) return []
  const modelHint = data.model as string | undefined
  const ts = extractTimestampFromObj(data) || fallbackTs
  return buildMessagesFromStats(stats, modelHint, path.basename(filePath, ".json"), ts)
}

function parseDirectGeminiMessage(
  value: Record<string, unknown>, modelHint: string | undefined, sessionId: string, fallbackTs: number,
): UnifiedMessage | null {
  const model = (value.model as string) || modelHint
  if (!model) return null
  const tokens = value.tokens as Record<string, unknown> | undefined
  if (!tokens) return null

  const rawInput = extractI64(tokens.input)
  const rawCached = extractI64(tokens.cached)
  const output = Math.max(0, extractI64(tokens.output))
  const reasoning = Math.max(0, extractI64(tokens.thoughts))
  const tool = Math.max(0, extractI64(tokens.tool))
  const total = tokens.total !== undefined ? extractI64(tokens.total) : null

  const [input, cacheRead] = normalizeSessionInputAndCache(rawInput, rawCached, output, reasoning, tool, total)
  if (input + output + cacheRead + reasoning === 0) return null

  const ts = extractTimestampFromObj(value) || fallbackTs
  return {
    client: "gemini", modelId: model, providerId: "google",
    sessionId, timestamp: ts, date: timestampToLocalDate(ts),
    tokens: { input, output, cacheRead, cacheWrite: 0, reasoning },
    cost: 0, messageCount: 1, isTurnStart: false,
  }
}

function buildMessagesFromStats(
  stats: Record<string, unknown>, modelHint: string | undefined, sessionId: string, timestamp: number,
): UnifiedMessage[] {
  const messages: UnifiedMessage[] = []
  const models = stats.models as Record<string, Record<string, unknown>> | undefined

  if (models && typeof models === "object") {
    for (const [modelId, data] of Object.entries(models)) {
      const tokens = data.tokens as Record<string, unknown> | undefined
      if (!tokens) continue
      const rawInput = tryNum(tokens, "prompt", "input", "input_tokens")
      const rawCached = tryNum(tokens, "cached", "cached_tokens")
      const output = tryNum(tokens, "candidates", "output", "output_tokens")
      const reasoning = tryNum(tokens, "thoughts", "reasoning")

      if (rawInput + output + rawCached + reasoning === 0) continue
      const [input, cacheRead] = normalizeHeadlessInputAndCache(rawInput, rawCached)

      messages.push({
        client: "gemini", modelId, providerId: "google",
        sessionId, timestamp, date: timestampToLocalDate(timestamp),
        tokens: { input, output, cacheRead, cacheWrite: 0, reasoning },
        cost: 0, messageCount: 1, isTurnStart: false,
      })
    }
    if (messages.length > 0) return messages
  }

  const rawInput = tryNum(stats, "input_tokens", "prompt_tokens")
  const output = tryNum(stats, "output_tokens", "candidates_tokens")
  const rawCached = tryNum(stats, "cached_tokens")
  const reasoning = tryNum(stats, "thoughts_tokens", "reasoning_tokens")
  if (rawInput + output + rawCached + reasoning === 0) return []

  const [input, cacheRead] = normalizeHeadlessInputAndCache(rawInput, rawCached)
  messages.push({
    client: "gemini", modelId: modelHint || "unknown", providerId: "google",
    sessionId, timestamp, date: timestampToLocalDate(timestamp),
    tokens: { input, output, cacheRead, cacheWrite: 0, reasoning },
    cost: 0, messageCount: 1, isTurnStart: false,
  })
  return messages
}

async function parseJsonlFile(filePath: string, fallbackTs: number): Promise<UnifiedMessage[]> {
  const messages: UnifiedMessage[] = []
  const directMessageIndices = new Map<string, number>()
  let sessionId = path.basename(filePath, ".jsonl")
  let currentModel: string | undefined

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const eventType = (obj.type as string) || ""

      if (eventType === "init") {
        if (obj.model) currentModel = obj.model as string
        const sid = (obj.session_id ?? obj.sessionId) as string | undefined
        if (sid) sessionId = sid
        continue
      }

      const sid = (obj.session_id ?? obj.sessionId) as string | undefined
      if (sid) sessionId = sid

      if (eventType === "gemini") {
        if (obj.model) currentModel = obj.model as string
        const msg = parseDirectGeminiMessage(obj, currentModel, sessionId, fallbackTs)
        if (msg) {
          const id = obj.id as string | undefined
          if (id) {
            const existing = directMessageIndices.get(id)
            if (existing !== undefined) {
              messages[existing] = msg
            } else {
              directMessageIndices.set(id, messages.length)
              messages.push(msg)
            }
          } else {
            messages.push(msg)
          }
        }
        continue
      }

      const stats = (obj.stats ?? (obj.result as Record<string, unknown>)?.stats) as Record<string, unknown> | undefined
      if (stats) {
        const ts = extractTimestampFromObj(obj) || fallbackTs
        messages.push(...buildMessagesFromStats(stats, currentModel, sessionId, ts))
      }
    } catch { /* skip */ }
  }
  return messages
}

export const geminiParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const fallbackTs = fileModifiedMs(filePath)
    if (filePath.endsWith(".jsonl")) {
      return parseJsonlFile(filePath, fallbackTs)
    }
    return parseSessionJson(filePath, fallbackTs)
  },
}

