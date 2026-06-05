import fs from "node:fs"
import readline from "node:readline"
import type {
  CcConversationParseError,
  CcRawConversationEvent,
} from "../../../src/types/usage-analysis-conversations"
import {
  redactSensitiveText,
  redactSensitiveValue,
} from "../../../src/lib/agent-redaction"

export type ParsedCcConversationFile = {
  readonly events: readonly CcRawConversationEvent[]
  readonly parseErrors: readonly CcConversationParseError[]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function parseTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeContentBlocks(message: Record<string, unknown> | undefined): readonly Record<string, unknown>[] {
  const content = message?.content

  if (Array.isArray(content)) {
    return content.flatMap((item) => {
      const block = asRecord(item)
      return block ? [block] : []
    })
  }

  if (typeof content === "string") {
    return [{ type: "string", text: content }]
  }

  return []
}

function firstToolUse(blocks: readonly Record<string, unknown>[]): { toolName?: string; toolUseId?: string } {
  const block = blocks.find((item) => item.type === "tool_use")
  return {
    toolName: asString(block?.name),
    toolUseId: asString(block?.id),
  }
}

function createEventId(raw: Record<string, unknown>, lineNumber: number, byteOffset: number): string {
  return asString(raw.uuid) ?? `${asString(raw.sessionId) ?? "unknown"}:${lineNumber}:${byteOffset}`
}

function toConversationEvent(
  raw: Record<string, unknown>,
  lineNumber: number,
  byteOffset: number,
): CcRawConversationEvent {
  const sanitizedRaw = asRecord(redactSensitiveValue(raw)) ?? raw
  const message = asRecord(sanitizedRaw.message)
  const contentBlocks = normalizeContentBlocks(message)
  const tool = firstToolUse(contentBlocks)
  const timestamp = asString(sanitizedRaw.timestamp)
  const timestampMs = parseTimestampMs(timestamp)
  const uuid = asString(sanitizedRaw.uuid)
  const parentUuid = sanitizedRaw.parentUuid === null ? null : asString(sanitizedRaw.parentUuid)
  const role = asString(message?.role)
  const model = asString(message?.model)
  const usage = asRecord(message?.usage)

  return {
    id: createEventId(raw, lineNumber, byteOffset),
    type: asString(sanitizedRaw.type) ?? "unknown",
    ...(timestamp ? { timestamp } : {}),
    ...(timestampMs !== undefined ? { timestampMs } : {}),
    lineNumber,
    byteOffset,
    ...(uuid ? { uuid } : {}),
    ...(parentUuid !== undefined ? { parentUuid } : {}),
    ...(role ? { role } : {}),
    ...(model ? { model } : {}),
    contentBlocks,
    ...(usage ? { usage } : {}),
    ...(tool.toolName ? { toolName: tool.toolName } : {}),
    ...(tool.toolUseId ? { toolUseId: tool.toolUseId } : {}),
    raw: sanitizedRaw,
  }
}

export async function parseCcConversationFile(filePath: string): Promise<ParsedCcConversationFile> {
  const events: CcRawConversationEvent[] = []
  const parseErrors: CcConversationParseError[] = []
  const reader = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  })
  let lineNumber = 0
  let byteOffset = 0

  try {
    for await (const line of reader) {
      lineNumber += 1
      const currentOffset = byteOffset
      byteOffset += Buffer.byteLength(line, "utf8") + 1

      if (!line.trim()) continue

      try {
        const raw = asRecord(JSON.parse(line) as unknown)
        if (!raw) {
          parseErrors.push({
            id: `parse-error:${lineNumber}`,
            lineNumber,
            byteOffset: currentOffset,
            message: "JSONL line is not an object.",
            rawLine: line,
          })
          continue
        }

        events.push(toConversationEvent(raw, lineNumber, currentOffset))
      } catch (error) {
        parseErrors.push({
          id: `parse-error:${lineNumber}`,
          lineNumber,
          byteOffset: currentOffset,
          message: error instanceof Error ? error.message : "Invalid JSONL line.",
          rawLine: redactSensitiveText(line),
        })
      }
    }
  } catch (error) {
    parseErrors.push({
      id: `stream-error:${lineNumber + 1}`,
      lineNumber: lineNumber + 1,
      byteOffset,
      message: redactSensitiveText(error instanceof Error ? error.message : String(error)),
      rawLine: "",
    })
  }

  return { events, parseErrors }
}
