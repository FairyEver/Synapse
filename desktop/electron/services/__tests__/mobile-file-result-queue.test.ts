import { afterEach, describe, expect, it, vi } from "vitest"
import { MobileFileResultQueue } from "../mobile-gateway/file-result-queue"

afterEach(() => vi.useRealTimers())

function harness() {
  vi.useFakeTimers()
  const sent: string[] = []
  const socket = { readyState: 1, bufferedAmount: 0, send: (payload: string) => { sent.push(payload) } }
  let current: typeof socket | null = socket
  const queue = new MobileFileResultQueue({
    socket: () => current,
    limits: { maxEnvelopeBytes: 128, maxQueuedPages: 2, maxQueuedBytes: 256, sendQueueTtlMs: 5000, maxSocketBufferedBytes: 512 },
    now: () => Date.now(), setTimeout, clearTimeout,
  })
  return { queue, socket, sent, disconnect: () => { current = null } }
}

describe("mobile file result queue", () => {
  it("charges final UTF-8 bytes and never crosses the socket buffer budget", async () => {
    const h = harness()
    h.socket.bufferedAmount = 511
    const pending = h.queue.send("中")
    expect(h.sent).toEqual([])
    expect(h.queue.facts()).toEqual({ pages: 1, bytes: 3 })
    h.socket.bufferedAmount = 509
    await vi.advanceTimersByTimeAsync(50)
    await pending
    expect(h.sent).toEqual(["中"])
    expect(h.queue.facts()).toEqual({ pages: 0, bytes: 0 })
    await expect(h.queue.send("中".repeat(43))).rejects.toThrow("limit_exceeded")
  })

  it("bounds pages and resolves queued pages in order after a stalled link recovers", async () => {
    const h = harness()
    h.socket.bufferedAmount = 512
    const first = h.queue.send("first")
    const second = h.queue.send("second")
    await expect(h.queue.send("third")).rejects.toThrow("transport_backpressure")
    h.socket.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(50)
    await Promise.all([first, second])
    expect(h.sent).toEqual(["first", "second"])
  })

  it("expires stalled pages explicitly without sending them later", async () => {
    const h = harness()
    h.socket.bufferedAmount = 512
    const failure = expect(h.queue.send("page")).rejects.toThrow("transport_backpressure")
    await vi.advanceTimersByTimeAsync(5000)
    await failure
    h.socket.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(100)
    expect(h.sent).toEqual([])
    expect(h.queue.facts()).toEqual({ pages: 0, bytes: 0 })
  })

  it("does not carry pages across a disconnected or replaced socket", async () => {
    const h = harness()
    h.socket.bufferedAmount = 512
    const failure = expect(h.queue.send("private page")).rejects.toThrow("desktop_offline")
    h.disconnect()
    await vi.advanceTimersByTimeAsync(50)
    await failure
    expect(h.sent).toEqual([])
    await expect(h.queue.send("page")).rejects.toThrow("desktop_offline")
  })

  it("reset releases every pending page and timer", async () => {
    const h = harness()
    h.socket.bufferedAmount = 512
    const failure = expect(h.queue.send("page")).rejects.toThrow("desktop_offline")
    h.queue.reset()
    await failure
    expect(h.queue.facts()).toEqual({ pages: 0, bytes: 0 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("prioritizes control and fails displaced reads instead of dropping them silently", async () => {
    const h = harness()
    h.socket.bufferedAmount = 512
    const first = h.queue.send("first")
    const displaced = expect(h.queue.send("second")).rejects.toThrow("transport_backpressure")
    const control = h.queue.send("close", true)
    await displaced
    expect(h.queue.facts().pages).toBe(2)
    h.socket.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(50)
    await Promise.all([control, first])
    expect(h.sent).toEqual(["close", "first"])
  })
})
