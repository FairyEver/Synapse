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
    const [msg, meta] = logger.error.mock.calls[0]
    expect(msg).toBe("Renderer console error.")
    expect(meta).toMatchObject({
      argCount: 2,
      boundary: "renderer.console",
      firstArgType: "string",
    })
    cleanup()
  })

  it("forwards console.warn to logger", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    console.warn("test warning")

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toBe("Renderer console warning.")
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
    expect(meta).toMatchObject({
      args: [
        { argType: "string", textLength: 3 },
        { argType: "object", serializedLength: 2048 },
      ],
    })
    cleanup()
  })

  it("extracts length diagnostics from Error instances", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    const err = new Error("something broke")
    console.error(err)

    const [msg, meta] = logger.error.mock.calls[0]
    expect(msg).toBe("Renderer console error.")
    expect(meta).toMatchObject({
      args: [{
        argType: "Error",
        errorName: "Error",
        messageLength: "something broke".length,
        stackLength: err.stack?.length,
      }],
    })
    cleanup()
  })

  it("logs console errors without raw message text", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    console.error(new Error("token=sk-secret at /Users/liyang/private/file.ts"))
    console.warn("failed with api_key=secret at /Users/liyang/private/file.ts")

    expect(logger.error).toHaveBeenCalledWith("Renderer console error.", expect.objectContaining({
      boundary: "renderer.console",
      firstArgType: "Error",
    }))
    expect(logger.warn).toHaveBeenCalledWith("Renderer console warning.", expect.objectContaining({
      boundary: "renderer.console",
      firstArgType: "string",
    }))
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("/Users/liyang/private")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("api_key=secret")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/Users/liyang/private")
    cleanup()
  })

  it("filters React dev-mode warnings in non-production", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installConsoleInterceptor(logger)

    console.warn("Warning: Each child in a list should have a unique key prop.")
    console.error("Warning: React does not recognize the `onClick` prop")
    console.warn("real warning from app code")

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toBe("Renderer console warning.")
    expect(logger.error).not.toHaveBeenCalled()
    cleanup()
  })
})
