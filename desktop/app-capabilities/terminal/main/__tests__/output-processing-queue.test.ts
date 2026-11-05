import { describe, expect, it, vi } from "vitest"
import { createTerminalProcessingQueue } from "../output-processing-queue"

const limits = { maxBytes: 8, maxTasks: 4, highBytes: 6, lowBytes: 2, highTasks: 3, lowTasks: 1 }

describe("Terminal processing queue lifecycle", () => {
  it("preserves output / resize order and measures wait and processing time", async () => {
    let now = 0
    let finish!: () => void
    const order: string[] = []
    const pressure = vi.fn()
    const queue = createTerminalProcessingQueue({ limits, now: () => now, onBackpressure: pressure })
    const first = queue.enqueue(6, () => new Promise<void>((resolve) => { finish = resolve; order.push("output") }))
    const second = queue.enqueue(0, () => { order.push("resize") })
    const third = queue.enqueue(2, () => { order.push("after") })
    await Promise.resolve()
    now = 12
    finish()
    await Promise.all([first, second, third, queue.ready()])
    expect(order).toEqual(["output", "resize", "after"])
    expect(pressure.mock.calls).toEqual([[true], [false]])
    expect(queue.diagnostics()).toMatchObject({ pendingBytes: 0, pendingTasks: 0, peakBytes: 8, maxWaitMs: 12, maxProcessingMs: 12 })
  })

  it("cancels the active operation and queued resize after a parser exception", async () => {
    const resize = vi.fn()
    const queue = createTerminalProcessingQueue({ limits })
    const first = queue.enqueue(1, () => { throw new Error("private terminal body") })
    const second = queue.enqueue(0, resize)
    const results = await Promise.allSettled([first, second, queue.ready()])
    for (const result of results) {
      expect(result.status).toBe("rejected")
      if (result.status === "rejected") expect(result.reason.message).toBe("emulator_unavailable")
    }
    expect(resize).not.toHaveBeenCalled()
    expect(queue.diagnostics()).toMatchObject({ pendingBytes: 0, pendingTasks: 0 })
    await expect(queue.enqueue(1, resize)).rejects.toMatchObject({ code: "emulator_unavailable" })
  })

  it("settles and aborts every waiter exactly once on hard overflow", async () => {
    const queue = createTerminalProcessingQueue({ limits })
    const abort = vi.fn()
    const first = queue.enqueue(8, (signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => { abort(); resolve() })))
    await Promise.resolve()
    const second = queue.enqueue(0, vi.fn())
    const overflow = queue.enqueue(1, vi.fn())
    const results = await Promise.allSettled([first, second, overflow, queue.ready()])
    expect(results.every((result) => result.status === "rejected")).toBe(true)
    expect(abort).toHaveBeenCalledOnce()
    queue.dispose()
    expect(abort).toHaveBeenCalledOnce()
    expect(queue.diagnostics()).toMatchObject({ pendingBytes: 0, pendingTasks: 0, rejectedTasks: 1, paused: false })
  })
})
