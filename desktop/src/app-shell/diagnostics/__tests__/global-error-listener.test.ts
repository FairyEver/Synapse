/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { installGlobalErrorListener } from "../global-error-listener"

describe("installGlobalErrorListener", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("captures window error events", () => {
    const cleanup = installGlobalErrorListener(logger)
    const event = new ErrorEvent("error", {
      message: "Test error",
      filename: "app.js",
      lineno: 42,
      colno: 10,
      error: new Error("Test error"),
    })
    window.dispatchEvent(event)

    expect(logger.error).toHaveBeenCalledWith("Renderer uncaught error.", expect.objectContaining({
      boundary: "renderer.global-error",
      filename: "app.js",
      lineno: 42,
      colno: 10,
      errorName: "Error",
      errorLength: "Test error".length,
    }))
    cleanup()
  })

  it("captures unhandled promise rejections with Error", () => {
    const cleanup = installGlobalErrorListener(logger)
    const error = new Error("async failure")
    const event = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: error,
    })
    window.dispatchEvent(event)

    expect(logger.error).toHaveBeenCalledWith("Renderer unhandled promise rejection.", expect.objectContaining({
      boundary: "renderer.global-error",
      type: "unhandledrejection",
      reasonType: "Error",
      errorName: "Error",
      errorLength: "async failure".length,
      stackLength: error.stack?.length,
    }))
    cleanup()
  })

  it("captures unhandled promise rejections with string reason", () => {
    const cleanup = installGlobalErrorListener(logger)
    const event = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: "string rejection",
    })
    window.dispatchEvent(event)

    expect(logger.error).toHaveBeenCalledWith("Renderer unhandled promise rejection.", expect.objectContaining({
      boundary: "renderer.global-error",
      type: "unhandledrejection",
      reasonType: "string",
      errorName: "string",
      errorLength: "string rejection".length,
    }))
    cleanup()
  })

  it("handles non-Error non-string rejection reasons", () => {
    const cleanup = installGlobalErrorListener(logger)
    const event = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: { code: 500 },
    })
    window.dispatchEvent(event)

    expect(logger.error).toHaveBeenCalledWith("Renderer unhandled promise rejection.", expect.objectContaining({
      boundary: "renderer.global-error",
      type: "unhandledrejection",
      reasonType: "object",
      errorName: "object",
      errorLength: 0,
    }))
    cleanup()
  })

  it("stops listening after cleanup", () => {
    const cleanup = installGlobalErrorListener(logger)
    cleanup()

    window.dispatchEvent(new ErrorEvent("error", { message: "after cleanup" }))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("logs uncaught renderer errors without raw message or stack text", () => {
    const cleanup = installGlobalErrorListener(logger)
    const error = new Error("render failed token=sk-secret at /Users/liyang/private/file.ts")
    const event = new ErrorEvent("error", {
      message: error.message,
      filename: "agent-panel.tsx",
      lineno: 42,
      colno: 10,
      error,
    })

    window.dispatchEvent(event)

    expect(logger.error).toHaveBeenCalledWith("Renderer uncaught error.", expect.objectContaining({
      boundary: "renderer.global-error",
      errorName: "Error",
      errorLength: error.message.length,
      stackLength: error.stack?.length,
      filename: "agent-panel.tsx",
      lineno: 42,
      colno: 10,
    }))
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("/Users/liyang/private")
    cleanup()
  })
})
