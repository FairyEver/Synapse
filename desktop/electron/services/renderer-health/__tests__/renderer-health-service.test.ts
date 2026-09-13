import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { RendererHealthService } from "../renderer-health-service"
import { DIAGNOSTICS_PING_CHANNEL, DIAGNOSTICS_PONG_CHANNEL } from "../constants"

function createMockWebContents() {
  const ipcHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const eventHandlers = new Map<string, ((...args: unknown[]) => void)[]>()
  return {
    send: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = eventHandlers.get(event) ?? []
      handlers.push(handler)
      eventHandlers.set(event, handlers)
    }),
    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      eventHandlers.set(event, (eventHandlers.get(event) ?? []).filter((candidate) => candidate !== handler))
    }),
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
    simulate(event: string, ...args: unknown[]) {
      for (const handler of eventHandlers.get(event) ?? []) handler(...args)
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

  it("defers recovery until the render-process-gone handler has unwound", async () => {
    const wc = createMockWebContents()
    const onUnavailable = vi.fn()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const service = new RendererHealthService({ logger, onUnavailable })
    service.attach(wc as never)

    wc.simulate("render-process-gone", {}, { reason: "crashed", exitCode: 5 })
    expect(onUnavailable).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await Promise.resolve()

    expect(onUnavailable).toHaveBeenCalledWith(wc, "crashed", { reason: "crashed", exitCode: 5 })
  })

  it("cancels deferred recovery when detached", () => {
    const wc = createMockWebContents()
    const onUnavailable = vi.fn()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const service = new RendererHealthService({ logger, onUnavailable })
    service.attach(wc as never)

    wc.simulate("render-process-gone", {}, { reason: "crashed", exitCode: 5 })
    service.detach()
    vi.advanceTimersByTime(0)

    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it("waits five seconds before stopping an unresponsive Renderer", async () => {
    const wc = createMockWebContents()
    const onUnavailable = vi.fn()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const service = new RendererHealthService({ logger, onUnavailable })
    service.attach(wc as never)

    wc.simulate("unresponsive")
    vi.advanceTimersByTime(4_999)
    expect(onUnavailable).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(onUnavailable).toHaveBeenCalledWith(wc, "unresponsive", undefined)
  })

  it("pauses delivery immediately and resumes it when the Renderer responds within five seconds", async () => {
    const wc = createMockWebContents()
    const onUnavailable = vi.fn()
    const onUnresponsive = vi.fn()
    const onResponsive = vi.fn()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const service = new RendererHealthService({
      logger,
      onUnavailable,
      onUnresponsive,
      onResponsive,
    })
    service.attach(wc as never)

    wc.simulate("unresponsive")
    await Promise.resolve()
    expect(onUnresponsive).toHaveBeenCalledWith(wc)

    vi.advanceTimersByTime(4_000)
    wc.simulate("responsive")
    await Promise.resolve()

    expect(onResponsive).toHaveBeenCalledWith(wc)
    vi.advanceTimersByTime(1_000)
    expect(onUnavailable).not.toHaveBeenCalled()
  })
})
