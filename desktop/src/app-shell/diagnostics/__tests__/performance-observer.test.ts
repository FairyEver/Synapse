import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installPerformanceObserver } from "../performance-observer"

describe("installPerformanceObserver", () => {
  let mockObserverInstance: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }
  let capturedCallback: ((list: { getEntries: () => unknown[] }) => void) | null = null

  beforeEach(() => {
    mockObserverInstance = { observe: vi.fn(), disconnect: vi.fn() }
    capturedCallback = null
    vi.stubGlobal("PerformanceObserver", class {
      constructor(cb: (list: { getEntries: () => unknown[] }) => void) {
        capturedCallback = cb
      }
      observe = mockObserverInstance.observe
      disconnect = mockObserverInstance.disconnect
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("logs long tasks exceeding 100ms", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installPerformanceObserver(logger)

    capturedCallback!({
      getEntries: () => [
        { entryType: "longtask", duration: 230, startTime: 14523, attribution: [] },
      ],
    })

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [msg, meta] = logger.warn.mock.calls[0]
    expect(msg).toContain("230")
    expect(meta).toHaveProperty("duration", 230)
    cleanup()
  })

  it("does not log tasks under 100ms", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installPerformanceObserver(logger)

    capturedCallback!({
      getEntries: () => [
        { entryType: "longtask", duration: 80, startTime: 1000, attribution: [] },
      ],
    })

    expect(logger.warn).not.toHaveBeenCalled()
    cleanup()
  })

  it("disconnects observer on cleanup", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installPerformanceObserver(logger)
    cleanup()
    expect(mockObserverInstance.disconnect).toHaveBeenCalled()
  })
})
