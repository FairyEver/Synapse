/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

    expect(logger.error).toHaveBeenCalledWith("Test error", expect.objectContaining({
      filename: "app.js",
      lineno: 42,
      colno: 10,
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

    expect(logger.error).toHaveBeenCalledWith("async failure", {
      type: "unhandledrejection",
      stack: error.stack,
    })
    cleanup()
  })

  it("captures unhandled promise rejections with string reason", () => {
    const cleanup = installGlobalErrorListener(logger)
    const event = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: "string rejection",
    })
    window.dispatchEvent(event)

    expect(logger.error).toHaveBeenCalledWith("string rejection", {
      type: "unhandledrejection",
      stack: undefined,
    })
    cleanup()
  })

  it("handles non-Error non-string rejection reasons", () => {
    const cleanup = installGlobalErrorListener(logger)
    const event = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: { code: 500 },
    })
    window.dispatchEvent(event)

    expect(logger.error).toHaveBeenCalledWith("Unhandled promise rejection", {
      type: "unhandledrejection",
      stack: undefined,
    })
    cleanup()
  })

  it("stops listening after cleanup", () => {
    const cleanup = installGlobalErrorListener(logger)
    cleanup()

    window.dispatchEvent(new ErrorEvent("error", { message: "after cleanup" }))
    expect(logger.error).not.toHaveBeenCalled()
  })
})
