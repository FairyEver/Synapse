import { BadRequestException } from "@nestjs/common"
import { EventEmitter } from "node:events"
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http"
import { PassThrough } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { DriveRemoteImageFetcher, MAX_REMOTE_IMAGE_BYTES } from "./drive-remote-image-fetcher"

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

type TestIncomingMessage = IncomingMessage & PassThrough

describe("DriveRemoteImageFetcher", () => {
  it("rejects private hosts before fetching", async () => {
    const request = vi.fn()
    const fetcher = new DriveRemoteImageFetcher(request as never)

    await expect(fetcher.fetchImage("http://127.0.0.1/a.png")).rejects.toBeInstanceOf(BadRequestException)
    expect(request).not.toHaveBeenCalled()
  })

  it("rejects unsupported protocols", async () => {
    const fetcher = new DriveRemoteImageFetcher()

    await expect(fetcher.fetchImage("file:///tmp/a.png")).rejects.toThrow("图片无法转存。")
  })

  it("downloads and validates a png image", async () => {
    const request = createStaticImageRequest(PNG_BYTES, { "content-type": "image/png" })
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    const result = await fetcher.fetchImage("https://example.test/a.png")

    expect(result.mimeType).toBe("image/png")
    expect(result.body.length).toBe(11)
  })

  it("rejects svg even when content type says image", async () => {
    const request = createStaticImageRequest(Buffer.from("<svg></svg>"), { "content-type": "image/svg+xml" })
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.svg")).rejects.toThrow("格式不支持。")
  })

  it("rejects a public-looking hostname when DNS resolves to private IP", async () => {
    const request = vi.fn()
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "10.0.0.1", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片无法转存。")
    expect(request).not.toHaveBeenCalled()
  })

  it("rejects redirect locations to private hosts", async () => {
    const request = createRedirectRequest("http://127.0.0.1/a.png")
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片无法转存。")
  })

  it("rejects content-length greater than max without reading body", async () => {
    let chunksRead = 0
    const request = createStreamingRequest({
      headers: { "content-length": String(MAX_REMOTE_IMAGE_BYTES + 1) },
      writeBody: (response) => {
        if (response.destroyed) return
        chunksRead += 1
        response.end(PNG_BYTES)
      },
    })
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片过大。")
    expect(chunksRead).toBe(0)
  })

  it("rejects image content type without an image signature", async () => {
    const request = createStaticImageRequest(Buffer.from("not an image"), { "content-type": "image/png" })
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("格式不支持。")
  })

  it("rejects png-like body with an incomplete png signature", async () => {
    const request = createStaticImageRequest(Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x00,
      0x00,
      0x00,
      0x00,
    ]), { "content-type": "image/png" })
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("格式不支持。")
  })

  it("rejects ORCHIDv2 IPv6 DNS results before fetching", async () => {
    const request = vi.fn()
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "2001:20::1", family: 6 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片无法转存。")
    expect(request).not.toHaveBeenCalled()
  })

  it("rejects oversized streaming body without reading the whole response", async () => {
    let chunksRead = 0
    const request = createStreamingRequest({
      writeBody: (response) => {
        response.write(PNG_BYTES)

        for (let index = 0; index < 150; index += 1) {
          chunksRead += 1
          response.write(Buffer.alloc(1024 * 1024))
          if (response.destroyed) return
        }

        response.end()
      },
    })
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片过大。")
    expect(chunksRead).toBeLessThan(150)
  })

  it("binds request lookup to preflight safe addresses", async () => {
    const lookupResults: Array<{ readonly address: string; readonly family: number }> = []
    const request = createStreamingRequest({
      beforeResponse: (_url, options) => {
        options.lookup?.("example.test", {}, (error, address, family) => {
          if (error) throw error
          lookupResults.push({ address: String(address), family: Number(family) })
        })
      },
      writeBody: (response) => response.end(PNG_BYTES),
    })
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await fetcher.fetchImage("https://example.test/a.png")

    expect(lookupResults).toEqual([{ address: "93.184.216.34", family: 4 }])
  })

  it("binds redirected requests to newly validated safe addresses", async () => {
    const lookupResults: Array<{ readonly address: string; readonly family: number }> = []
    const request = vi.fn((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      options.lookup?.(url.hostname, {}, (error, address, family) => {
        if (error) throw error
        lookupResults.push({ address: String(address), family: Number(family) })
      })

      const request = createMockClientRequest()
      queueMicrotask(() => {
        if (url.hostname === "example.test") {
          const response = createResponse(302, { location: "https://cdn.example.test/a.png" })
          callback(response)
          setImmediate(() => response.end())
          return
        }

        const response = createResponse(200)
        callback(response)
        setImmediate(() => response.end(PNG_BYTES))
      })
      return request
    })
    const fetcher = new DriveRemoteImageFetcher(request as never, async (hostname) => {
      if (hostname === "example.test") return [{ address: "93.184.216.34", family: 4 }]
      return [{ address: "93.184.216.35", family: 4 }]
    })

    await fetcher.fetchImage("https://example.test/a.png")

    expect(lookupResults).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.35", family: 4 },
    ])
  })

  it("rejects timed out requests", async () => {
    const request = vi.fn(() => {
      const request = createMockClientRequest()
      request.setTimeout = vi.fn((_timeoutMs: number, callback: () => void) => {
        queueMicrotask(callback)
        return request
      }) as never
      return request
    })
    const fetcher = new DriveRemoteImageFetcher(request as never, async () => [
      { address: "93.184.216.34", family: 4 },
    ])

    await expect(fetcher.fetchImage("https://example.test/a.png")).rejects.toThrow("图片无法转存。")
  })
})

function createStaticImageRequest(body: Buffer, headers: Record<string, string> = {}) {
  return createStreamingRequest({
    headers,
    writeBody: (response) => response.end(body),
  })
}

function createRedirectRequest(location: string) {
  return createStreamingRequest({
    statusCode: 302,
    headers: { location },
    writeBody: (response) => response.end(),
  })
}

function createStreamingRequest(input: {
  readonly statusCode?: number
  readonly headers?: Record<string, string>
  readonly beforeResponse?: (url: URL, options: RequestOptions) => void
  readonly writeBody: (response: TestIncomingMessage) => void
}) {
  return vi.fn((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    input.beforeResponse?.(url, options)

    const request = createMockClientRequest()
    queueMicrotask(() => {
      const response = createResponse(input.statusCode ?? 200, input.headers)
      callback(response)
      setImmediate(() => input.writeBody(response))
    })
    return request
  })
}

function createResponse(statusCode: number, headers: Record<string, string> = {}): TestIncomingMessage {
  const response = new PassThrough() as unknown as TestIncomingMessage
  response.statusCode = statusCode
  response.headers = headers
  return response
}

function createMockClientRequest(): ClientRequest {
  const request = new EventEmitter() as ClientRequest
  request.end = vi.fn(() => request) as never
  request.destroy = vi.fn(() => request) as never
  request.setTimeout = vi.fn(() => request) as never
  return request
}
