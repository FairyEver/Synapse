export interface Utf8TruncateResult {
  readonly text: string
  readonly truncated: boolean
}

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8")

export function truncateUtf8StringToBytes(value: string, maxBytes: number): Utf8TruncateResult {
  validateUtf8MaxBytes(maxBytes)
  const bytes = encoder.encode(value)
  if (bytes.length <= maxBytes) return { text: value, truncated: false }
  return { text: decodeUtf8Prefix(bytes, maxBytes), truncated: true }
}

export function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number = bytes.byteLength): string {
  validateUtf8MaxBytes(maxBytes)
  const end = safeUtf8PrefixLength(bytes, Math.min(maxBytes, bytes.byteLength))
  return decoder.decode(bytes.subarray(0, end))
}

function safeUtf8PrefixLength(bytes: Uint8Array, end: number): number {
  if (end <= 0) return 0
  let sequenceStart = end - 1
  while (sequenceStart >= 0 && isUtf8ContinuationByte(bytes[sequenceStart] ?? 0)) {
    sequenceStart -= 1
  }
  if (sequenceStart < 0) return 0
  const expectedLength = utf8SequenceLength(bytes[sequenceStart] ?? 0)
  if (expectedLength === 0) return sequenceStart
  return end - sequenceStart >= expectedLength ? end : sequenceStart
}

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80
}

function utf8SequenceLength(byte: number): number {
  if ((byte & 0x80) === 0) return 1
  if ((byte & 0xe0) === 0xc0) return 2
  if ((byte & 0xf0) === 0xe0) return 3
  if ((byte & 0xf8) === 0xf0) return 4
  return 0
}

function validateUtf8MaxBytes(maxBytes: number): void {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new Error("maxBytes 必须是非负数字。")
}
