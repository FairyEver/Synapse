import { createGenericJsonlParser } from "./generic-jsonl"
import { extractI64 } from "./utils"
import type { AgentParser } from "./types"

export const piParser: AgentParser = createGenericJsonlParser({
  clientId: "pi",
  providerId: "anthropic",
  extractModel: (obj) => {
    const msg = obj.message as Record<string, unknown> | undefined
    return (msg?.model as string) || "unknown"
  },
  extractUsage: (obj) => {
    const msg = obj.message as Record<string, unknown> | undefined
    const usage = msg?.usage as Record<string, unknown> | undefined
    if (!usage) return null
    return {
      input: extractI64(usage.input),
      output: extractI64(usage.output),
      cacheRead: extractI64(usage.cacheRead) || extractI64(usage.cache_read),
      cacheWrite: extractI64(usage.cacheWrite) || extractI64(usage.cache_write),
      reasoning: 0,
    }
  },
  extractTimestamp: (obj) => obj.timestamp,
  extractSessionId: (obj) => (obj.id as string) || "",
})

export const qwenParser: AgentParser = createGenericJsonlParser({
  clientId: "qwen",
  providerId: "alibaba",
  extractModel: (obj) => (obj.model as string) || "unknown",
  extractUsage: (obj) => {
    if (obj.type !== "assistant") return null
    const usage = obj.usageMetadata as Record<string, unknown> | undefined
    if (!usage) return null
    return {
      input: extractI64(usage.promptTokenCount),
      output: extractI64(usage.candidatesTokenCount),
      cacheRead: extractI64(usage.cachedContentTokenCount),
      cacheWrite: 0,
      reasoning: extractI64(usage.thoughtsTokenCount),
    }
  },
  extractTimestamp: (obj) => obj.timestamp,
  extractSessionId: (obj) => (obj.sessionId as string) || "",
})

export const kimiParser: AgentParser = createGenericJsonlParser({
  clientId: "kimi",
  providerId: "moonshot",
  lineFilter: "token_usage",
  extractModel: () => "kimi-for-coding",
  extractUsage: (obj) => {
    const msg = obj.message as Record<string, unknown> | undefined
    const payload = msg?.payload as Record<string, unknown> | undefined
    const usage = payload?.token_usage as Record<string, unknown> | undefined
    if (!usage) return null
    return {
      input: extractI64(usage.input_other),
      output: extractI64(usage.output),
      cacheRead: extractI64(usage.input_cache_read),
      cacheWrite: extractI64(usage.input_cache_creation),
      reasoning: 0,
    }
  },
  extractTimestamp: (obj) => {
    const ts = obj.timestamp
    if (typeof ts === "number" && ts < 1e12) return ts * 1000
    return ts
  },
})

export const antigravityParser: AgentParser = createGenericJsonlParser({
  clientId: "antigravity",
  providerId: "anthropic",
  lineFilter: "usage",
  extractModel: (obj) => (obj.modelId as string) || "unknown",
  extractUsage: (obj) => {
    if (obj.type !== "usage") return null
    return {
      input: extractI64(obj.input),
      output: extractI64(obj.output),
      cacheRead: extractI64(obj.cacheRead),
      cacheWrite: extractI64(obj.cacheWrite),
      reasoning: extractI64(obj.reasoning),
    }
  },
  extractTimestamp: (obj) => obj.timestamp,
  extractSessionId: (obj) => (obj.sessionId as string) || "",
})
