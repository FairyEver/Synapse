import { describe, expect, it, vi } from "vitest"

import { CustomAppFaviconService } from "../favicon-service"

describe("CustomAppFaviconService", () => {
  it("discovers and normalizes a page favicon", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === "https://example.com/read") {
        return new Response('<link rel="icon" href="/icon.png">', {
          headers: { "Content-Type": "text/html" },
        })
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      })
    })
    const normalizeImage = vi.fn(async () => "iVBOR...")
    const service = new CustomAppFaviconService({ fetch, normalizeImage })

    await expect(service.fetchFavicon("https://example.com/read")).resolves.toEqual({
      pngBase64: "iVBOR...",
      dataUrl: "data:image/png;base64,iVBOR...",
    })
  })

  it("returns null when favicon discovery fails", async () => {
    const service = new CustomAppFaviconService({
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
      normalizeImage: vi.fn(),
    })

    await expect(service.fetchFavicon("https://broken.example")).resolves.toBeNull()
  })

  it("rejects unsupported and oversized local images", async () => {
    const service = new CustomAppFaviconService({
      fetch: vi.fn(),
      normalizeImage: vi.fn(),
      chooseFile: vi.fn().mockResolvedValue("/tmp/icon.svg"),
      readFile: vi.fn().mockResolvedValue(Buffer.from("<svg/>")),
    })

    await expect(service.chooseIcon()).resolves.toBeNull()
  })

  it("bounds favicon candidates and rejects streamed bodies over the byte limit", async () => {
    const links = Array.from({ length: 20 }, (_, index) =>
      `<link rel="icon" href="/icon-${index}.png">`).join("")
    const fetch = vi.fn(async (url: string) => {
      if (url === "https://example.com/read") {
        return new Response(links, { headers: { "Content-Type": "text/html" } })
      }
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(600 * 1024))
          controller.close()
        },
      }), {
        headers: { "Content-Type": "image/png" },
      })
    })
    const normalizeImage = vi.fn(async () => "iVBOR...")
    const service = new CustomAppFaviconService({ fetch, normalizeImage })

    await expect(service.fetchFavicon("https://example.com/read")).resolves.toBeNull()
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(9)
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("icon-19.png"),
      expect.anything(),
    )
    expect(normalizeImage).not.toHaveBeenCalled()
  })

  it("checks the local file size before reading it", async () => {
    const readFile = vi.fn()
    const stat = vi.fn(async () => ({ size: 3 * 1024 * 1024 }))
    const service = new CustomAppFaviconService({
      fetch: vi.fn(),
      normalizeImage: vi.fn(),
      chooseFile: vi.fn().mockResolvedValue("/tmp/icon.png"),
      readFile,
      stat,
    })

    await expect(service.chooseIcon()).resolves.toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })
})
