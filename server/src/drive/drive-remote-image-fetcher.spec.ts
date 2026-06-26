import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { DriveRemoteImageFetcher, MAX_REMOTE_IMAGE_BYTES } from "./drive-remote-image-fetcher"

describe("DriveRemoteImageFetcher", () => {
  it("rejects private hosts before fetching", async () => {
    const fetch = vi.fn()
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch)

    await expect(fetcher.fetchImage("http://127.0.0.1/a.png")).rejects.toBeInstanceOf(BadRequestException)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects unsupported protocols", async () => {
    const fetcher = new DriveRemoteImageFetcher()

    await expect(fetcher.fetchImage("file:///tmp/a.png")).rejects.toThrow("图片无法转存。")
  })

  it("downloads and validates a png image", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      1,
      2,
      3,
    ]), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    const result = await fetcher.fetchImage("https://example.test/a.png")

    expect(result.mimeType).toBe("image/png")
    expect(result.body.length).toBe(11)
  })

  it("rejects svg even when content type says image", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<svg></svg>", {
      status: 200,
      headers: { "content-type": "image/svg+xml" },
    }))
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.svg")).rejects.toThrow("格式不支持。")
  })

  it("rejects a public-looking hostname when DNS resolves to private IP", async () => {
    const fetch = vi.fn()
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch, async () => [
      { address: "10.0.0.1", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片无法转存。")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects redirect locations to private hosts", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/a.png" },
    }))
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片无法转存。")
  })

  it("rejects content-length greater than max without reading body", async () => {
    const arrayBuffer = vi.fn()
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(MAX_REMOTE_IMAGE_BYTES + 1) }),
      arrayBuffer,
    } as unknown as Response)
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片过大。")
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it("rejects image content type without an image signature", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("not an image", {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("格式不支持。")
  })

  it("rejects png-like body with an incomplete png signature", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x00,
      0x00,
      0x00,
      0x00,
    ]), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("格式不支持。")
  })

  it("rejects ORCHIDv2 IPv6 DNS results before fetching", async () => {
    const fetch = vi.fn()
    const fetcher = new DriveRemoteImageFetcher(fetch as unknown as typeof globalThis.fetch, async () => [
      { address: "2001:20::1", family: 6 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片无法转存。")
    expect(fetch).not.toHaveBeenCalled()
  })
})
