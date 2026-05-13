import { describe, it, expect, vi, afterEach } from "vitest"
import { installConsoleInterceptor } from "../console-interceptor"

describe("installConsoleInterceptor", () => {
  const originalError = console.error
  const originalWarn = console.warn

  afterEach(() => {
    console.error = originalError
    console.warn = originalWarn
  })

  it("forwards console.error to logger", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    console.error("test error", { foo: 1 })

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [msg] = logger.error.mock.calls[0]
    expect(msg).toContain("test error")
    cleanup()
  })

  it("forwards console.warn to logger", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    console.warn("test warning")

    expect(logger.warn).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it("restores original console methods on cleanup", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)
    cleanup()
    console.error("after cleanup")
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("truncates large objects", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    const largeObj = { data: "x".repeat(5000) }
    console.error("big", largeObj)

    const [, meta] = logger.error.mock.calls[0]
    const serialized = typeof meta === "string" ? meta : JSON.stringify(meta)
    expect(serialized.length).toBeLessThanOrEqual(2200)
    cleanup()
  })

  it("extracts message and stack from Error instances", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    const err = new Error("something broke")
    console.error(err)

    const [msg, meta] = logger.error.mock.calls[0]
    expect(msg).toContain("something broke")
    expect(meta).toHaveProperty("stack")
    cleanup()
  })
})
