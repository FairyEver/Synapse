import fs from "node:fs"
import type {
  CcConversationChunk,
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

type ConversationChunkCursor = {
  readonly byteOffset: number
  readonly lineNumber: number
}

export type ParseCcConversationChunkOptions = {
  readonly cursor?: string
  readonly limit?: number
}

const DEFAULT_CHUNK_LIMIT = 200
const MAX_CHUNK_LIMIT = 1000

function normalizeChunkLimit(value: unknown): number {
  const limit = Math.trunc(Number(value))
  if (!Number.isFinite(limit)) return DEFAULT_CHUNK_LIMIT
  return Math.min(Math.max(limit, 1), MAX_CHUNK_LIMIT)
}

function encodeChunkCursor(cursor: ConversationChunkCursor): string {
  return `${cursor.byteOffset}:${cursor.lineNumber}`
}

function decodeChunkCursor(value: string | undefined): ConversationChunkCursor {
  if (!value) return { byteOffset: 0, lineNumber: 0 }
  const [byteOffsetRaw, lineNumberRaw] = value.split(":")
  const byteOffset = Math.trunc(Number(byteOffsetRaw))
  const lineNumber = Math.trunc(Number(lineNumberRaw))
  if (!Number.isFinite(byteOffset) || !Number.isFinite(lineNumber) || byteOffset < 0 || lineNumber < 0) {
    throw new Error("Invalid CC conversation cursor")
  }
  return { byteOffset, lineNumber }
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
  let lineNumber = 0
  let byteOffset = 0

  try {
    for await (const parsedLine of readConversationLines(filePath)) {
      lineNumber += 1
      const line = parsedLine.line
      const currentOffset = parsedLine.byteOffset
      byteOffset = parsedLine.nextByteOffset

      if (!line.trim()) continue

      try {
        const parsed = JSON.parse(line) as unknown
        const raw = asRecord(parsed)
        if (!raw) {
          parseErrors.push({
            id: `parse-error:${lineNumber}`,
            lineNumber,
            byteOffset: currentOffset,
            message: "JSONL line is not an object.",
            rawLine: redactNonObjectRawLine(line, parsed),
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

export async function parseCcConversationFileChunk(
  filePath: string,
  options: ParseCcConversationChunkOptions = {},
): Promise<CcConversationChunk> {
  const events: CcRawConversationEvent[] = []
  const parseErrors: CcConversationParseError[] = []
  const limit = normalizeChunkLimit(options.limit)
  const cursor = decodeChunkCursor(options.cursor)
  let lineNumber = cursor.lineNumber
  let byteOffset = cursor.byteOffset
  let emittedCount = 0
  let hasMore = false
  let nextCursor: string | undefined

  try {
    for await (const parsedLine of readConversationLines(filePath, cursor.byteOffset)) {
      lineNumber += 1
      const line = parsedLine.line
      const currentOffset = parsedLine.byteOffset
      byteOffset = parsedLine.nextByteOffset

      if (!line.trim()) continue
      if (emittedCount >= limit) {
        hasMore = true
        nextCursor = encodeChunkCursor({ byteOffset: currentOffset, lineNumber: lineNumber - 1 })
        break
      }

      emittedCount += 1
      try {
        const parsed = JSON.parse(line) as unknown
        const raw = asRecord(parsed)
        if (!raw) {
          parseErrors.push({
            id: `parse-error:${lineNumber}`,
            lineNumber,
            byteOffset: currentOffset,
            message: "JSONL line is not an object.",
            rawLine: redactNonObjectRawLine(line, parsed),
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

  return {
    events,
    parseErrors,
    hasMore,
    ...(nextCursor ? { nextCursor } : {}),
  }
}

async function* readConversationLines(
  filePath: string,
  start = 0,
): AsyncGenerator<{ readonly line: string; readonly byteOffset: number; readonly nextByteOffset: number }> {
  const stream = fs.createReadStream(filePath, { start })
  let pending = Buffer.alloc(0)
  let pendingOffset = start
  let streamOffset = start

  for await (const chunk of stream) {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const bufferOffset = pending.length > 0 ? pendingOffset : streamOffset
    const buffer = pending.length > 0 ? Buffer.concat([pending, chunkBuffer]) : chunkBuffer
    let lineStart = 0

    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 0x0A) continue
      const lineEnd = index > lineStart && buffer[index - 1] === 0x0D ? index - 1 : index
      yield {
        line: buffer.subarray(lineStart, lineEnd).toString("utf8"),
        byteOffset: bufferOffset + lineStart,
        nextByteOffset: bufferOffset + index + 1,
      }
      lineStart = index + 1
    }

    pending = buffer.subarray(lineStart)
    pendingOffset = bufferOffset + lineStart
    streamOffset += chunkBuffer.length
  }

  if (pending.length > 0) {
    yield {
      line: pending.toString("utf8"),
      byteOffset: pendingOffset,
      nextByteOffset: pendingOffset + pending.length,
    }
  }
}

function redactNonObjectRawLine(line: string, parsed: unknown): string {
  return typeof parsed === "string" ? redactSensitiveText(parsed) : redactSensitiveText(line)
}
