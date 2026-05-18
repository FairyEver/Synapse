import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { RendererHealthService } from "../renderer-health-service"
import { DIAGNOSTICS_PING_CHANNEL, DIAGNOSTICS_PONG_CHANNEL } from "../constants"

function createMockWebContents() {
  const ipcHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    on: vi.fn(),
    removeListener: vi.fn(),
    ipc: {
      on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
        const arr = ipcHandlers.get(channel) ?? []
        arr.push(handler)
        ipcHandlers.set(channel, arr)
      }),
      removeListener: vi.fn(),
    },
    _ipcHandlers: ipcHandlers,
    simulatePong() {
      const pongHandlers = ipcHandlers.get(DIAGNOSTICS_PONG_CHANNEL) ?? []
      for (const h of pongHandlers) h({})
    },
  }
}

describe("RendererHealthService", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("sends ping at configured interval", () => {
    const wc = createMockWebContents()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger })
    service.attach(wc as never)

    vi.advanceTimersByTime(30_000)
    expect(wc.send).toHaveBeenCalledWith(DIAGNOSTICS_PING_CHANNEL)
  })

  it("logs warning when pong not received within timeout", () => {
    const wc = createMockWebContents()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger })
    service.attach(wc as never)

    vi.advanceTimersByTime(30_000)
    vi.advanceTimersByTime(5_000)

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toContain("无响应")
  })

  it("does not warn when pong received in time", () => {
    const wc = createMockWebContents()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger })
    service.attach(wc as never)

    vi.advanceTimersByTime(30_000)
    wc.simulatePong()
    vi.advanceTimersByTime(5_000)

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("logs error after 3 consecutive misses", () => {
    const wc = createMockWebContents()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger })
    service.attach(wc as never)

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(30_000)
      vi.advanceTimersByTime(5_000)
    }

    expect(logger.error).toHaveBeenCalled()
    expect(logger.error.mock.calls[0][0]).toContain("冻结")
  })

  it("logs recovery after freeze then pong", () => {
    const wc = createMockWebContents()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger })
    service.attach(wc as never)

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(30_000)
      vi.advanceTimersByTime(5_000)
    }

    vi.advanceTimersByTime(30_000)
    wc.simulatePong()

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("恢复"),
      expect.anything(),
    )
  })

  it("catches send exception and detaches gracefully", () => {
    const wc = createMockWebContents()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger })
    service.attach(wc as never)

    wc.send.mockImplementation(() => { throw new Error("Object has been destroyed") })

    vi.advanceTimersByTime(30_000)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("心跳发送失败"),
      expect.anything(),
    )
    wc.send.mockClear()
    vi.advanceTimersByTime(60_000)
    expect(wc.send).not.toHaveBeenCalled()
  })

  it("stops on detach", () => {
    const wc = createMockWebContents()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    const service = new RendererHealthService({ logger })
    service.attach(wc as never)
    service.detach()

    vi.advanceTimersByTime(60_000)
    expect(wc.send).not.toHaveBeenCalled()
  })
})
