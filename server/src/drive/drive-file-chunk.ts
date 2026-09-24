import type { DriveFileContentChunkResult } from "@synapse/shared"

const SOURCE_TARGET_BYTES = 8 * 1024
const MCP_RESPONSE_MAX_BYTES = 16 * 1024
const decoder = new TextDecoder("utf-8", { fatal: true })

export function encodeDriveReadCursor(leaseId: string, offset: number): string {
  return Buffer.from(JSON.stringify({ leaseId, offset }), "utf8").toString("base64url")
}

export function decodeDriveReadCursor(cursor: string): { readonly leaseId: string; readonly offset: number } {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { leaseId?: unknown; offset?: unknown }
    if (typeof value.leaseId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/u.test(value.leaseId) || !Number.isSafeInteger(value.offset) || Number(value.offset) < 0) throw new Error("bad cursor")
    return { leaseId: value.leaseId, offset: Number(value.offset) }
  } catch {
    throw new Error("DRIVE_FILE_READ_CURSOR_INVALID")
  }
}

export function alignDriveUtf8Start(bytes: Buffer): number {
  let offset = 0
  while (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80) offset++
  return offset
}

export function createDriveTextChunk(input: {
  readonly itemId: string
  readonly versionId: string
  readonly leaseId: string
  readonly source: Buffer
  readonly sourceStartByte: number
  readonly totalBytes: number
  readonly mode: "beginning" | "tail" | "around"
  readonly anchorByte?: number
}): DriveFileContentChunkResult {
  const source = input.source.subarray(0, Math.min(input.source.length, SOURCE_TARGET_BYTES + 4))
  const sourceEnd = trimUtf8End(source)
  let selected = source.subarray(0, sourceEnd)
  let startByte = input.sourceStartByte
  if (input.mode === "tail") {
    let low = 0
    let high = selected.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      const aligned = middle + alignDriveUtf8Start(selected.subarray(middle))
      const candidate = selected.subarray(aligned)
      if (responseBytes(buildResult(input, candidate, startByte + aligned)) <= MCP_RESPONSE_MAX_BYTES) high = middle
      else low = middle + 1
    }
    const aligned = low + alignDriveUtf8Start(selected.subarray(low))
    selected = selected.subarray(aligned)
    startByte += aligned
  } else {
    let low = 0
    let high = selected.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      const aligned = trimUtf8End(selected.subarray(0, middle))
      if (responseBytes(buildResult(input, selected.subarray(0, aligned), startByte)) <= MCP_RESPONSE_MAX_BYTES) low = middle
      else high = middle - 1
    }
    const aligned = trimUtf8End(selected.subarray(0, low))
    selected = selected.subarray(0, aligned)
  }
  const result = buildResult(input, selected, startByte)
  if (selected.length === 0 && startByte < input.totalBytes) throw new Error("Drive chunk could not fit one character.")
  if (input.mode === "around" && input.anchorByte !== undefined && (input.anchorByte < result.startByte || input.anchorByte > result.endByte)) {
    throw new Error("Drive chunk did not cover its anchor.")
  }
  if (responseBytes(result) > MCP_RESPONSE_MAX_BYTES) throw new Error("Drive MCP chunk response exceeded budget.")
  return result
}

function buildResult(input: Parameters<typeof createDriveTextChunk>[0], bytes: Buffer, startByte: number): DriveFileContentChunkResult {
  const endByte = startByte + bytes.length
  return {
    itemId: input.itemId,
    versionId: input.versionId,
    text: decoder.decode(bytes),
    startByte,
    endByte,
    totalBytes: input.totalBytes,
    nextCursor: endByte === input.totalBytes ? null : encodeDriveReadCursor(input.leaseId, endByte),
    endOfFile: endByte === input.totalBytes,
  }
}

function responseBytes(result: DriveFileContentChunkResult): number {
  const dispatchResult = { ok: true, data: result }
  const mcpResult = { content: [{ type: "text", text: JSON.stringify(dispatchResult, null, 2) }] }
  return Buffer.byteLength(JSON.stringify(mcpResult), "utf8")
}

function trimUtf8End(bytes: Buffer): number {
  let end = bytes.length
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      decoder.decode(bytes.subarray(0, end))
      return end
    } catch {
      end--
      if (end < 0) break
    }
  }
  throw new Error("Drive text contains invalid UTF-8.")
}
