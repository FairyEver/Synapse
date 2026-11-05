import { describe, expect, it, vi } from "vitest"
import { createTerminalRendererOutputRelay } from "../renderer-output-relay"

const chunk = (sessionId: string, seq: number, data = "x") => ({ sessionId, seq, data, source: "pty" as const, createdAt: "now" })

describe("Terminal visible renderer relay", () => {
  it("keeps output before resize and isolates subscribers while removing stale windows", () => {
    vi.useFakeTimers()
    try {
      const emit = vi.fn()
      const relay = createTerminalRendererOutputRelay(emit)
      relay.report(1, ["a"])
      relay.report(2, ["a", "b"])
      relay.append(chunk("a", 1))
      relay.report(1, ["a"])
      relay.flushSession("a") // The IPC resize handler flushes this barrier first.
      expect(emit.mock.calls[0]).toEqual([{ sessionId: "a", chunks: [chunk("a", 1)] }, new Set([1, 2])])
      relay.append(chunk("b", 2))
      relay.forget(2)
      expect(relay.diagnostics()).toMatchObject({ pendingBytes: 0, pendingSessions: 0, subscribedWindows: 1 })
      expect(vi.getTimerCount()).toBe(0)
      relay.append(chunk("a", 3))
      relay.deleteSession("a")
      relay.append(chunk("a", 4))
      expect(emit.mock.calls[1]).toEqual([{ sessionId: "a", chunks: [chunk("a", 3)] }, new Set([1])])
      expect(relay.diagnostics()).toMatchObject({ pendingBytes: 0, pendingSessions: 0, subscribedWindows: 0 })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it("bounds a frame by both bytes and objects, including empty chunks and oversized resyncs", () => {
    vi.useFakeTimers()
    try {
      const emit = vi.fn()
      const relay = createTerminalRendererOutputRelay(emit)
      relay.report(1, ["a"])
      for (let seq = 1; seq <= 1000; seq += 1) relay.append(chunk("a", seq, ""))
      expect(emit.mock.calls.every(([batch]) => batch.chunks.length <= 64)).toBe(true)
      relay.append(chunk("a", 1001, "x".repeat(70_000)))
      relay.append(chunk("a", 1002, "not-needed-after-resync"))
      vi.advanceTimersByTime(20)
      expect(emit.mock.calls.at(-1)?.[0]).toEqual({ sessionId: "a", chunks: [], resyncRequired: true })
      expect(relay.diagnostics()).toMatchObject({ pendingBytes: 0, pendingSessions: 0, oversizedChunks: 1 })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
