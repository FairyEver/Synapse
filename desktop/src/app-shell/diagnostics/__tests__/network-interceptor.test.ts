import { describe, it, expect, vi, afterEach } from "vitest"
import { installNetworkInterceptor } from "../network-interceptor"

describe("installNetworkInterceptor", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("logs non-ok responses", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      url: "https://api.example.com/license/validate",
    })

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("https://api.example.com/license/validate", { method: "POST" })

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [msg, meta] = logger.warn.mock.calls[0]
    expect(msg).toContain("POST")
    expect(msg).toContain("429")
    expect(meta).toHaveProperty("url")
    cleanup()
  })

  it("logs network errors", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("https://api.example.com/data").catch(() => {})

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [msg] = logger.error.mock.calls[0]
    expect(msg).toContain("Failed to fetch")
    cleanup()
  })

  it("does not log successful responses", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("https://api.example.com/ok")

    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    cleanup()
  })

  it("skips file:// protocol requests", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"))

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("file:///local/resource.json").catch(() => {})

    expect(logger.error).not.toHaveBeenCalled()
    cleanup()
  })

  it("sanitizes sensitive query params", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      url: "https://api.example.com/auth?token=secret123&key=abc",
    })

    const cleanup = installNetworkInterceptor(logger)
    await globalThis.fetch("https://api.example.com/auth?token=secret123&key=abc")

    const [, meta] = logger.warn.mock.calls[0]
    expect((meta as { url: string }).url).not.toContain("secret123")
    expect((meta as { url: string }).url).not.toContain("abc")
    cleanup()
  })

  it("restores original fetch on cleanup", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Error", url: "http://x" })
    globalThis.fetch = mockFetch

    const cleanup = installNetworkInterceptor(logger)
    cleanup()

    await globalThis.fetch("http://x")
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
