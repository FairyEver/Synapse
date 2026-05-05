import fs from "node:fs"
import path from "node:path"
import type { AgentParser, UnifiedMessage } from "./types"
import { extractI64, fileModifiedMs, timestampToLocalDate } from "./utils"

function parseTimestampValue(ts: unknown): number | null {
  if (typeof ts === "string") {
    const n = Number(ts)
    if (Number.isFinite(n) && n > 1e9) return n > 1e12 ? n : n * 1000
    const d = new Date(ts)
    return Number.isFinite(d.getTime()) ? d.getTime() : null
  }
  if (typeof ts === "number") {
    if (ts > 1e12) return ts
    if (ts > 1e9) return ts * 1000
  }
  return null
}

function extractTagValue(block: string, tag: string): string | undefined {
  const open = `<${tag}>`
  const close = `</${tag}>`
  const startIdx = block.indexOf(open)
  if (startIdx < 0) return undefined
  const valueStart = startIdx + open.length
  const endIdx = block.indexOf(close, valueStart)
  if (endIdx < 0) return undefined
  const value = block.slice(valueStart, endIdx).trim()
  return value || undefined
}

function readTaskMetadata(uiMessagesPath: string): { model: string; agent?: string } {
  const historyPath = path.join(path.dirname(uiMessagesPath), "api_conversation_history.json")
  try {
    const content = fs.readFileSync(historyPath, "utf-8")
    return extractModelAndAgent(content)
  } catch {
    return { model: "unknown" }
  }
}

function extractModelAndAgent(content: string): { model: string; agent?: string } {
  const ENV_START = "<environment_details>"
  const ENV_END = "</environment_details>"

  let offset = 0
  let lastModel: string | undefined
  let lastSlug: string | undefined
  let lastName: string | undefined

  while (offset < content.length) {
    const startRel = content.indexOf(ENV_START, offset)
    if (startRel < 0) break
    const startIdx = startRel + ENV_START.length
    const endIdx = content.indexOf(ENV_END, startIdx)
    if (endIdx < 0) break
    const block = content.slice(startIdx, endIdx)

    const model = extractTagValue(block, "model")
    if (model) lastModel = model
    const slug = extractTagValue(block, "slug")
    if (slug) lastSlug = slug
    const name = extractTagValue(block, "name")
    if (name) lastName = name

    offset = endIdx + ENV_END.length
  }

  const model = lastModel || "unknown"
  const agent = lastSlug || lastName
  return { model, agent }
}

function providerFromApiProtocol(apiProtocol: string | undefined): string {
  if (!apiProtocol || !apiProtocol.trim()) return "unknown"
  return apiProtocol.trim()
}

function createRooStyleParser(clientId: string): AgentParser {
  return {
    async parseFile(filePath: string): Promise<UnifiedMessage[]> {
      const messages: UnifiedMessage[] = []
      const fallbackTs = fileModifiedMs(filePath)
      const sessionId = path.basename(path.dirname(filePath)) || "unknown"
      const { model: taskModel, agent } = readTaskMetadata(filePath)

      try {
        const entries = JSON.parse(fs.readFileSync(filePath, "utf-8"))
        if (!Array.isArray(entries)) return messages

        for (const entry of entries) {
          if (entry.type !== "say" || entry.say !== "api_req_started") continue
          const text = entry.text as string | undefined
          if (!text) continue

          const ts = parseTimestampValue(entry.ts)
          if (ts === null) continue

          try {
            const payload = JSON.parse(text)

            const input = Math.max(0, extractI64(payload.tokensIn))
            const output = Math.max(0, extractI64(payload.tokensOut))
            const cacheRead = Math.max(0, extractI64(payload.cacheReads))
            const cacheWrite = Math.max(0, extractI64(payload.cacheWrites))
            if (input + output === 0) continue

            const cost = typeof payload.cost === "number" ? Math.max(0, payload.cost) : 0
            const provider = providerFromApiProtocol(payload.apiProtocol as string | undefined)

            messages.push({
              client: clientId,
              modelId: taskModel,
              providerId: provider,
              sessionId,
              agent,
              timestamp: ts,
              date: timestampToLocalDate(ts),
              tokens: { input, output, cacheRead, cacheWrite, reasoning: 0 },
              cost,
              messageCount: 1,
              isTurnStart: false,
            })
          } catch { /* skip malformed text */ }
        }
      } catch { /* skip */ }

      return messages
    },
  }
}

export const roocodeParser = createRooStyleParser("roocode")
export const kilocodeParser = createRooStyleParser("kilocode")
