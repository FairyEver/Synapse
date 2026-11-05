import {
  TERMINAL_RENDERER_BATCH_INTERVAL_MS,
  TERMINAL_RENDERER_BATCH_MAX_BYTES,
  TERMINAL_RENDERER_BATCH_MAX_CHUNKS,
} from "../../../config"
import type { TerminalOutputChunk } from "../shared/schema"

export type TerminalRendererOutputBatch = {
  readonly sessionId: string
  readonly chunks: readonly TerminalOutputChunk[]
  readonly resyncRequired?: boolean
}

/** 单个 Terminal service 的有界输出中继；仅传给显式报告可见会话的窗口。 */
export function createTerminalRendererOutputRelay(
  emit: (batch: TerminalRendererOutputBatch, recipients: ReadonlySet<number>) => void,
) {
  const visibleByWindow = new Map<number, ReadonlySet<string>>()
  const windowsBySession = new Map<string, Set<number>>()
  const pending = new Map<string, { chunks: TerminalOutputChunk[]; bytes: number; resyncRequired?: boolean }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let sentBatches = 0
  let sentChunks = 0
  let oversizedChunks = 0
  let peakPendingBytes = 0
  let pendingBytes = 0

  function forget(windowId: number): void {
    for (const id of visibleByWindow.get(windowId) ?? []) {
      const windows = windowsBySession.get(id)
      windows?.delete(windowId)
      if (!windows?.size) windowsBySession.delete(id)
    }
    visibleByWindow.delete(windowId)
    prune()
  }
  function stopEmptyTimer(): void {
    if (pending.size || !timer) return
    clearTimeout(timer)
    timer = undefined
  }
  function flushSession(sessionId: string): void {
    const batch = pending.get(sessionId)
    if (!batch) return
    pending.delete(sessionId)
    pendingBytes -= batch.bytes
    stopEmptyTimer()
    const windows = windowsBySession.get(sessionId)
    if (!windows?.size) return
    const recipients = new Set(windows)
    sentBatches += 1
    sentChunks += batch.chunks.length
    emit({ sessionId, chunks: batch.chunks, ...(batch.resyncRequired ? { resyncRequired: true } : {}) }, recipients)
  }
  function prune(): void {
    for (const [sessionId, batch] of pending) if (!windowsBySession.has(sessionId)) {
      pendingBytes -= batch.bytes
      pending.delete(sessionId)
    }
    stopEmptyTimer()
  }
  return {
    report(windowId: number, sessionIds: readonly string[]) {
      // 先更新反向索引再 prune，避免同一窗口重复报告时丢掉已排队的输出。
      const ids = new Set(sessionIds)
      for (const id of visibleByWindow.get(windowId) ?? []) {
        if (ids.has(id)) continue
        const windows = windowsBySession.get(id)
        windows?.delete(windowId)
        if (!windows?.size) windowsBySession.delete(id)
      }
      if (ids.size) visibleByWindow.set(windowId, ids)
      else visibleByWindow.delete(windowId)
      for (const id of ids) {
        let windows = windowsBySession.get(id)
        if (!windows) { windows = new Set(); windowsBySession.set(id, windows) }
        windows.add(windowId)
      }
      prune()
    },
    forget,
    append(chunk: TerminalOutputChunk) {
      if (!windowsBySession.has(chunk.sessionId)) return
      const bytes = Buffer.byteLength(chunk.data, "utf8")
      let batch = pending.get(chunk.sessionId)
      if (batch && !batch.resyncRequired && (batch.chunks.length === TERMINAL_RENDERER_BATCH_MAX_CHUNKS || batch.bytes + bytes > TERMINAL_RENDERER_BATCH_MAX_BYTES)) {
        flushSession(chunk.sessionId)
        batch = undefined
      }
      if (!batch) {
        batch = { chunks: [], bytes: 0 }
        pending.set(chunk.sessionId, batch)
      }
      if (bytes > TERMINAL_RENDERER_BATCH_MAX_BYTES) {
        oversizedChunks += 1
        pendingBytes -= batch.bytes
        batch.chunks = []
        batch.bytes = 0
        batch.resyncRequired = true
      } else if (!batch.resyncRequired) {
        batch.chunks.push(chunk)
        batch.bytes += bytes
        pendingBytes += bytes
      }
      peakPendingBytes = Math.max(peakPendingBytes, pendingBytes)
      if (!timer) timer = setTimeout(() => {
        timer = undefined
        for (const sessionId of [...pending.keys()]) flushSession(sessionId)
      }, TERMINAL_RENDERER_BATCH_INTERVAL_MS)
    },
    flushSession,
    deleteSession(sessionId: string) {
      flushSession(sessionId)
      windowsBySession.delete(sessionId)
      for (const [windowId, ids] of visibleByWindow) {
        if (!ids.has(sessionId)) continue
        const remaining = new Set([...ids].filter((id) => id !== sessionId))
        if (remaining.size) visibleByWindow.set(windowId, remaining)
        else visibleByWindow.delete(windowId)
      }
    },
    diagnostics: () => ({ subscribedWindows: visibleByWindow.size, pendingSessions: pending.size, pendingBytes, peakPendingBytes, sentBatches, sentChunks, oversizedChunks }),
  }
}
