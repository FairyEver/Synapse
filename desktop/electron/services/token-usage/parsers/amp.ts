import fs from "node:fs"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, parseTimestamp, fileModifiedMs, timestampToLocalDate } from "./utils"

interface UsageRecord {
  model: string
  timestamp: number
  hasExplicitTimestamp: boolean
  messageId: number | null
  ledgerToMessageId: number | null
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }
  cost: number
}

function inferProvider(model: string): string {
  const m = model.toLowerCase()
  if (m.includes("claude") || m.includes("anthropic")) return "anthropic"
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) return "openai"
  if (m.includes("gemini")) return "google"
  if (m.includes("deepseek")) return "deepseek"
  return "anthropic"
}

function parseLedgerRecords(data: Record<string, unknown>, threadCreatedMs: number, fileMtimeMs: number): UsageRecord[] {
  const ledger = data.usageLedger as Record<string, unknown> | undefined
  const events = (ledger?.events || []) as Record<string, unknown>[]
  const records: UsageRecord[] = []

  for (const event of events) {
    const model = event.model as string | undefined
    if (!model) continue
    const explicitTs = parseTimestamp(event.timestamp)
    const timestamp = explicitTs || (threadCreatedMs > 0 ? threadCreatedMs : fileMtimeMs)
    const tokens = (event.tokens || {}) as Record<string, unknown>
    const toMessageId = extractI64(event.toMessageId)

    records.push({
      model,
      timestamp,
      hasExplicitTimestamp: !!explicitTs,
      messageId: null,
      ledgerToMessageId: toMessageId > 0 ? toMessageId : null,
      tokens: {
        input: Math.max(0, extractI64(tokens.input)),
        output: Math.max(0, extractI64(tokens.output)),
        cacheRead: Math.max(0, extractI64(tokens.cacheReadInputTokens)),
        cacheWrite: Math.max(0, extractI64(tokens.cacheCreationInputTokens)),
        reasoning: 0,
      },
      cost: Math.max(0, Number(event.credits) || 0),
    })
  }
  return records
}

function parseMessageRecords(data: Record<string, unknown>, threadCreatedMs: number, fileMtimeMs: number): UsageRecord[] {
  const msgs = (data.messages || []) as Record<string, unknown>[]
  const records: UsageRecord[] = []
  const baseTimestamp = threadCreatedMs > 0 ? threadCreatedMs : fileMtimeMs

  for (const msg of msgs) {
    if (msg.role !== "assistant") continue
    const usage = msg.usage as Record<string, unknown> | undefined
    if (!usage) continue
    const model = usage.model as string | undefined
    if (!model) continue
    const messageId = Math.max(0, extractI64(msg.messageId))
    const timestamp = baseTimestamp + messageId * 1000

    records.push({
      model,
      timestamp,
      hasExplicitTimestamp: false,
      messageId: messageId > 0 ? messageId : null,
      ledgerToMessageId: null,
      tokens: {
        input: Math.max(0, extractI64(usage.inputTokens)),
        output: Math.max(0, extractI64(usage.outputTokens)),
        cacheRead: Math.max(0, extractI64(usage.cacheReadInputTokens)),
        cacheWrite: Math.max(0, extractI64(usage.cacheCreationInputTokens)),
        reasoning: 0,
      },
      cost: Math.max(0, Number(usage.credits) || 0),
    })
  }
  return records
}

function matchesUsage(a: UsageRecord, b: UsageRecord): boolean {
  return a.model === b.model && a.tokens.input === b.tokens.input && a.tokens.output === b.tokens.output
    && a.tokens.cacheRead === b.tokens.cacheRead && a.tokens.cacheWrite === b.tokens.cacheWrite
}

function findMatchingLedger(ledger: UsageRecord[], consumed: boolean[], searchStart: number, msgRec: UsageRecord): number {
  const find = (pred: (i: number) => boolean): number => {
    for (let i = searchStart; i < ledger.length; i++) if (pred(i)) return i
    for (let i = 0; i < searchStart; i++) if (pred(i)) return i
    return -1
  }
  if (msgRec.messageId !== null) {
    const idx = find((i) => !consumed[i] && ledger[i].ledgerToMessageId === msgRec.messageId)
    if (idx >= 0) return idx
  }
  return find((i) => !consumed[i] && matchesUsage(ledger[i], msgRec))
}

function mergeRecords(ledger: UsageRecord, msg: UsageRecord): UsageRecord {
  if (ledger.hasExplicitTimestamp) {
    return { ...ledger, cost: ledger.cost > 0 ? ledger.cost : msg.cost, messageId: msg.messageId }
  }
  return {
    ...ledger,
    timestamp: msg.timestamp,
    messageId: msg.messageId,
    cost: ledger.cost > 0 ? ledger.cost : msg.cost,
  }
}

function toUnified(rec: UsageRecord, threadId: string): UnifiedMessage {
  return {
    client: "amp",
    modelId: rec.model,
    providerId: inferProvider(rec.model),
    sessionId: threadId,
    timestamp: rec.timestamp,
    date: timestampToLocalDate(rec.timestamp),
    tokens: rec.tokens,
    cost: rec.cost,
    messageCount: 1,
    isTurnStart: false,
  }
}

export const ampParser: AgentParser = {
  async parseFile(filePath: string): Promise<UnifiedMessage[]> {
    const fileMtimeMs = fileModifiedMs(filePath)
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>
      const threadId = (data.id as string) || filePath.split("/").pop()?.replace(/\.json$/, "") || "unknown"
      const threadCreatedMs = extractI64(data.created)

      const ledgerRecords = parseLedgerRecords(data, threadCreatedMs, fileMtimeMs)
      const messageRecords = parseMessageRecords(data, threadCreatedMs, fileMtimeMs)

      if (ledgerRecords.length === 0) {
        messageRecords.sort((a, b) => a.timestamp - b.timestamp)
        return messageRecords.map((r) => toUnified(r, threadId))
      }

      const consumed = new Array(ledgerRecords.length).fill(false) as boolean[]
      let searchStart = 0
      const unmatched: UsageRecord[] = []

      for (const msgRec of messageRecords) {
        const idx = findMatchingLedger(ledgerRecords, consumed, searchStart, msgRec)
        if (idx >= 0) {
          consumed[idx] = true
          searchStart = idx + 1
          ledgerRecords[idx] = mergeRecords(ledgerRecords[idx], msgRec)
        } else {
          unmatched.push(msgRec)
        }
      }

      const all = [...ledgerRecords, ...unmatched]
      all.sort((a, b) => a.timestamp - b.timestamp)
      return all.map((r) => toUnified(r, threadId))
    } catch { return [] }
  },
}
