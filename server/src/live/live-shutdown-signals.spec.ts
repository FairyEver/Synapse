import { describe, expect, it, vi } from "vitest"
import {
  registerLiveShutdownSignalHandlers,
  type LiveShutdownSignalTarget,
} from "./live-shutdown-signals"

class FakeSignalTarget implements LiveShutdownSignalTarget {
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

describe("registerLiveShutdownSignalHandlers", () => {
  it("closes live desktop sockets when process shutdown signals arrive", () => {
    const target = new FakeSignalTarget()
    const gateway = { onApplicationShutdown: vi.fn() }

    registerLiveShutdownSignalHandlers(gateway, target)
    target.emit("SIGTERM")
    target.emit("SIGTERM")
    target.emit("SIGINT")

    expect(gateway.onApplicationShutdown).toHaveBeenCalledTimes(2)
    expect(gateway.onApplicationShutdown).toHaveBeenNthCalledWith(1, "SIGTERM")
    expect(gateway.onApplicationShutdown).toHaveBeenNthCalledWith(2, "SIGINT")
  })
})
