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
})
