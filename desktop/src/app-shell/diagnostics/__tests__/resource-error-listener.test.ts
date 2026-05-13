/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { installResourceErrorListener } from "../resource-error-listener"

describe("installResourceErrorListener", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("logs script load failures", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)

    const script = document.createElement("script")
    script.src = "/assets/chunk-abc.js"
    document.body.appendChild(script)
    script.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [msg, meta] = logger.error.mock.calls[0]
    expect(msg).toContain("script")
    expect(meta).toHaveProperty("src", "/assets/chunk-abc.js")
    cleanup()
  })

  it("logs image load failures", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)

    const img = document.createElement("img")
    img.src = "/images/avatar.png"
    document.body.appendChild(img)
    img.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [msg] = logger.error.mock.calls[0]
    expect(msg).toContain("img")
    cleanup()
  })

  it("logs link/stylesheet load failures", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)

    const link = document.createElement("link")
    link.href = "/styles/main.css"
    link.rel = "stylesheet"
    document.body.appendChild(link)
    link.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it("ignores non-resource error events", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)

    const div = document.createElement("div")
    document.body.appendChild(div)
    div.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).not.toHaveBeenCalled()
    cleanup()
  })

  it("removes listener on cleanup", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cleanup = installResourceErrorListener(logger)
    cleanup()

    const script = document.createElement("script")
    script.src = "/fail.js"
    document.body.appendChild(script)
    script.dispatchEvent(new Event("error", { bubbles: false }))

    expect(logger.error).not.toHaveBeenCalled()
  })
})
