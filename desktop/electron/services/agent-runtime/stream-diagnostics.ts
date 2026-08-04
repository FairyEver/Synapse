import type { AgentEventEntryV1 } from "../../runtime/data-repo"

export const MAX_STREAM_DIAGNOSTIC_BYTES_PER_TURN = 512 * 1024
export const MAX_STREAM_DIAGNOSTIC_EVENTS_PER_TURN = 1_000
export const MAX_EXPORTED_STREAM_DIAGNOSTIC_BYTES = 8 * 1024 * 1024

export interface StreamDiagnosticFrame {
  readonly sequence: number
  readonly createdAt: string
  readonly payload: Record<string, unknown>
}

export interface StreamDiagnosticCapture {
  frames: StreamDiagnosticFrame[]
  capturedBytes: number
  observedEventCount: number
  truncated: boolean
}

export interface StreamDiagnosticChunkPayload extends Record<string, unknown> {
  readonly type: "streamDiagnostics"
  readonly schemaVersion: 1
  readonly source: "claude-agent-sdk-stream-event"
  readonly frames: readonly StreamDiagnosticFrame[]
  readonly observedEventCount: number
  readonly capturedEventCount: number
  readonly capturedBytes: number
  readonly truncated: boolean
  readonly limits: {
    readonly maxEventsPerTurn: number
    readonly maxBytesPerTurn: number
  }
}

export function isStreamDiagnosticEntry(
  entry: AgentEventEntryV1,
): entry is AgentEventEntryV1 & { payload: StreamDiagnosticChunkPayload } {
  return entry.eventType === "streamDiagnostics"
    && entry.payload.type === "streamDiagnostics"
    && Array.isArray(entry.payload.frames)
}
