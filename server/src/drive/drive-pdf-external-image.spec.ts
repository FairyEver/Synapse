import { EventEmitter } from "node:events"
import dns from "node:dns/promises"
import http from "node:http"
import { Readable } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchSafeExternalImage, isPublicAddress } from "./drive-pdf-external-image"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe("Drive PDF external image address policy", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fc00::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("accepts public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  it("re-resolves and pins every redirect hop", async () => {
    const lookup = mockLookup([
      [{ address: "93.184.216.34", family: 4 }],
      [{ address: "142.250.72.14", family: 4 }],
    ])
    const get = mockHttpResponses([
      response(302, Buffer.alloc(0), { location: "http://cdn.example/image.png" }),
      response(200, png, { "content-type": "image/png" }),
    ])

    await expect(fetchSafeExternalImage("http://example.com/image.png", {
      maxBytes: 1024,
      timeoutMs: 1_000,
      maxRedirects: 3,
    })).resolves.toEqual({ bytes: png, mimeType: "image/png" })
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenCalledTimes(2)
    expectPinnedLookup(get, 0, "93.184.216.34")
    expectPinnedLookup(get, 1, "142.250.72.14")
  })

  it("blocks a redirect hop when DNS returns any private address", async () => {
    mockLookup([
      [{ address: "93.184.216.34", family: 4 }],
      [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    ])
    const get = mockHttpResponses([
      response(302, Buffer.alloc(0), { location: "http://rebound.example/image.png" }),
    ])

    await expect(fetchSafeExternalImage("http://example.com/image.png", {
      maxBytes: 1024,
      timeoutMs: 1_000,
    })).rejects.toThrow("EXTERNAL_IMAGE_ADDRESS_BLOCKED")
    expect(get).toHaveBeenCalledOnce()
  })

  it("times out while DNS resolution is stalled", async () => {
    vi.useFakeTimers()
    vi.spyOn(dns, "lookup").mockImplementation((() => new Promise(() => undefined)) as typeof dns.lookup)
    const get = vi.spyOn(http, "get")
    const operation = fetchSafeExternalImage("http://example.com/image.png", {
      maxBytes: 1024,
      timeoutMs: 250,
    })
    const rejection = expect(operation).rejects.toThrow("EXTERNAL_IMAGE_TIMEOUT")

    await vi.advanceTimersByTimeAsync(250)
    await rejection
    expect(get).not.toHaveBeenCalled()
  })

  it("rejects a response whose declared MIME type contradicts its signature", async () => {
    mockLookup([[{ address: "93.184.216.34", family: 4 }]])
    mockHttpResponses([response(200, png, { "content-type": "text/html" })])

    await expect(fetchSafeExternalImage("http://example.com/image.png", {
      maxBytes: 1024,
      timeoutMs: 1_000,
    })).rejects.toThrow("EXTERNAL_IMAGE_MIME_INVALID")
  })

  it("rejects an oversized declared response before reading its body", async () => {
    mockLookup([[{ address: "93.184.216.34", family: 4 }]])
    const body = response(200, png, {
      "content-length": "2048",
      "content-type": "image/png",
    })
    const destroy = vi.spyOn(body, "destroy")
    mockHttpResponses([body])

    await expect(fetchSafeExternalImage("http://example.com/image.png", {
      maxBytes: 1024,
      timeoutMs: 1_000,
    })).rejects.toThrow("EXTERNAL_IMAGE_TOO_LARGE")
    expect(destroy).toHaveBeenCalledOnce()
  })

  it.each([
    "http://user:password@example.com/image.png",
    "http://example.com:8080/image.png",
    "ftp://example.com/image.png",
  ])("rejects unsafe URL %s before DNS or network access", async (source) => {
    const lookup = vi.spyOn(dns, "lookup")
    const get = vi.spyOn(http, "get")

    await expect(fetchSafeExternalImage(source, {
      maxBytes: 1024,
      timeoutMs: 1_000,
    })).rejects.toThrow("EXTERNAL_IMAGE_URL_INVALID")
    expect(lookup).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
})

function mockLookup(results: Array<Array<{ readonly address: string; readonly family: number }>>): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(dns, "lookup").mockImplementation((async () => {
    const next = results.shift()
    if (!next) throw new Error("unexpected DNS lookup")
    return next
  }) as unknown as typeof dns.lookup)
}

function mockHttpResponses(responses: http.IncomingMessage[]): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(http, "get").mockImplementation(((
    _url: URL,
    _options: http.RequestOptions,
    callback: (value: http.IncomingMessage) => void,
  ) => {
    const next = responses.shift()
    if (!next) throw new Error("unexpected HTTP request")
    const request = fakeRequest()
    queueMicrotask(() => callback(next))
    return request
  }) as typeof http.get)
}

function response(statusCode: number, body: Buffer, headers: http.IncomingHttpHeaders): http.IncomingMessage {
  const stream = Readable.from([body]) as http.IncomingMessage
  stream.statusCode = statusCode
  stream.headers = headers
  return stream
}

function fakeRequest(): http.ClientRequest {
  const request = new EventEmitter() as http.ClientRequest
  request.setTimeout = vi.fn(() => request) as never
  request.destroy = vi.fn((error?: Error) => {
    if (error) queueMicrotask(() => request.emit("error", error))
    return request
  }) as never
  return request
}

function expectPinnedLookup(get: ReturnType<typeof vi.spyOn>, call: number, address: string): void {
  const options = get.mock.calls[call]?.[1] as http.RequestOptions
  const callback = vi.fn()
  options.lookup?.("ignored.example", {}, callback)
  expect(callback).toHaveBeenCalledWith(null, address, 4)
}
