import { describe, expect, it, vi } from "vitest"

import { acquireUrlSource, type FetchUrl } from "../url-source"

function response(input: {
  readonly url?: string
  readonly status?: number
  readonly contentType?: string
  readonly body?: string
  readonly contentLength?: string
} = {}): Awaited<ReturnType<FetchUrl>> {
  return {
    url: input.url ?? "https://example.com/a",
    status: input.status ?? 200,
    headers: {
      get: (name: string) => {
        const normalized = name.toLowerCase()
        if (normalized === "content-type") return input.contentType ?? "text/html; charset=utf-8"
        if (normalized === "content-length") return input.contentLength ?? null
        return null
      },
    },
    text: async () => input.body ?? "<html><body><article><h1>Title</h1><p>Hello <strong>world</strong>.</p></article></body></html>",
  }
}

describe("acquireUrlSource", () => {
  it("converts a valid HTML URL into source markdown with frontmatter", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/a",
      fetchUrl: async () => response(),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.message)
    expect(result.source.markdown).toContain('source_url: "https://example.com/a"')
    expect(result.source.markdown).toContain('source_final_url: "https://example.com/a"')
    expect(result.source.markdown).toContain('source_format: "url"')
    expect(result.source.markdown).toContain('fetched_at: "2026-05-24T00:00:00.000Z"')
    expect(result.source.markdown).toContain('content_type: "text/html"')
    expect(result.source.markdown).toContain("# Title")
    expect(result.source.markdown).toContain("Hello **world**.")
  })

  it("records the final URL after redirect", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/a",
      fetchUrl: async () => response({ url: "https://www.example.com/b" }),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.message)
    expect(result.source.originalUrl).toBe("https://example.com/a")
    expect(result.source.finalUrl).toBe("https://www.example.com/b")
    expect(result.source.markdown).toContain('source_final_url: "https://www.example.com/b"')
  })

  it("rejects unsupported protocols before fetching", async () => {
    const fetchUrl = vi.fn<FetchUrl>()

    const result = await acquireUrlSource({
      url: "file:///tmp/source.html",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: false, code: "unsupported_protocol" })
    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it("rejects localhost and private URL hosts by default", async () => {
    const fetchUrl = vi.fn<FetchUrl>()

    await expect(acquireUrlSource({
      url: "http://localhost:3000/a",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })).resolves.toMatchObject({ ok: false, code: "local_or_private_host" })

    await expect(acquireUrlSource({
      url: "https://192.168.0.4/a",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })).resolves.toMatchObject({ ok: false, code: "local_or_private_host" })

    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it("rejects oversized responses", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/large",
      fetchUrl: async () => response({
        contentLength: "6",
        body: "abcdef",
      }),
      maxBytes: 5,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: false, code: "size_limit_exceeded" })
  })

  it("returns a structured error on network failure", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/a",
      fetchUrl: async () => {
        throw new Error("socket closed")
      },
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toEqual({
      ok: false,
      code: "network_error",
      message: "socket closed",
    })
  })
})
