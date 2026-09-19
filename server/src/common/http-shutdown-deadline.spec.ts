import { createServer } from "node:http"
import { connect, type AddressInfo, type Server } from "node:net"
import { describe, expect, it, vi } from "vitest"
import {
  httpShutdownForceCloseDelayMs,
  registerHttpShutdownDeadline,
  type ShutdownDeadlineScheduler,
} from "./http-shutdown-deadline"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// A connection only blocks close() once the server has accepted and tracked it.
async function waitForTrackedConnections(server: Server): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const count = await new Promise<number>((resolve) => server.getConnections((_error, tracked) => resolve(tracked)))
    if (count > 0) {
      return
    }
    await delay(10)
  }
  throw new Error("Timed out waiting for the server to track the connection.")
}

class FakeSignalTarget {
  private readonly listeners = new Map<NodeJS.Signals, Array<() => void>>()

  once(signal: NodeJS.Signals, listener: () => void): unknown {
    const listeners = this.listeners.get(signal) ?? []
    listeners.push(listener)
    this.listeners.set(signal, listeners)
    return this
  }

  emit(signal: NodeJS.Signals): void {
    const listeners = this.listeners.get(signal) ?? []
    this.listeners.delete(signal)
    for (const listener of listeners) {
      listener()
    }
  }
}

class FakeScheduler {
  readonly scheduled: Array<{ listener: () => void; delayMs: number; unref: ReturnType<typeof vi.fn> }> = []

  schedule: ShutdownDeadlineScheduler = (listener, delayMs) => {
    const unref = vi.fn()
    this.scheduled.push({ listener, delayMs, unref })
    return { unref }
  }

  runScheduled(): void {
    for (const entry of this.scheduled) {
      entry.listener()
    }
  }
}

describe("registerHttpShutdownDeadline", () => {
  it("forces the remaining connections closed only after the grace period", () => {
    const target = new FakeSignalTarget()
    const scheduler = new FakeScheduler()
    const closeAllConnections = vi.fn()

    registerHttpShutdownDeadline({ closeAllConnections }, target, undefined, scheduler.schedule)
    target.emit("SIGTERM")

    expect(scheduler.scheduled).toHaveLength(1)
    expect(scheduler.scheduled[0]?.delayMs).toBe(httpShutdownForceCloseDelayMs)
    expect(closeAllConnections).not.toHaveBeenCalled()

    scheduler.runScheduled()

    expect(closeAllConnections).toHaveBeenCalledTimes(1)
  })

  it("lets the process exit before the deadline by unreferencing the timer", () => {
    const target = new FakeSignalTarget()
    const scheduler = new FakeScheduler()

    registerHttpShutdownDeadline({ closeAllConnections: vi.fn() }, target, undefined, scheduler.schedule)
    target.emit("SIGTERM")

    expect(scheduler.scheduled[0]?.unref).toHaveBeenCalledTimes(1)
  })

  it("arms once per termination signal and ignores repeats", () => {
    const target = new FakeSignalTarget()
    const scheduler = new FakeScheduler()

    registerHttpShutdownDeadline({ closeAllConnections: vi.fn() }, target, undefined, scheduler.schedule)
    target.emit("SIGTERM")
    target.emit("SIGTERM")
    target.emit("SIGINT")

    expect(scheduler.scheduled).toHaveLength(2)
  })

  it("tolerates servers that cannot force connections closed", () => {
    const target = new FakeSignalTarget()
    const scheduler = new FakeScheduler()

    registerHttpShutdownDeadline({}, target, undefined, scheduler.schedule)
    target.emit("SIGTERM")

    expect(() => scheduler.runScheduled()).not.toThrow()
  })

  it("unblocks a real server whose close callback waits on a connection that never completed a response", async () => {
    const server = createServer(() => {
      // Never answers: the connection stays pending from the server's view.
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as AddressInfo).port
    const socket = connect(port, "127.0.0.1")
    socket.on("error", () => {})
    await new Promise((resolve) => socket.on("connect", resolve))
    await waitForTrackedConnections(server)

    const closed = vi.fn()
    server.close(closed)
    await delay(50)
    expect(closed).not.toHaveBeenCalled()

    const target = new FakeSignalTarget()
    registerHttpShutdownDeadline(server, target, ["SIGTERM"], (listener) => setTimeout(listener, 10))
    target.emit("SIGTERM")
    await delay(100)

    expect(closed).toHaveBeenCalledTimes(1)
    socket.destroy()
  })
})
