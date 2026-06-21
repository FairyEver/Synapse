import { describe, expect, it, vi } from "vitest"

import { sourceUrlFrontmatter } from "../html-to-source-markdown"
import { acquireUrlSource, type FetchUrl } from "../url-source"

function response(input: {
  readonly url?: string
  readonly status?: number
  readonly contentType?: string | null
  readonly body?: string
  readonly contentLength?: string
  readonly discard?: () => void
} = {}): Awaited<ReturnType<FetchUrl>> {
  return {
    url: input.url ?? "https://example.com/a",
    status: input.status ?? 200,
    headers: {
      get: (name: string) => {
        const normalized = name.toLowerCase()
        if (normalized === "content-type") {
          return input.contentType === null ? null : input.contentType ?? "text/html; charset=utf-8"
        }
        if (normalized === "content-length") return input.contentLength ?? null
        return null
      },
    },
    discard: input.discard,
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

  it("redacts sensitive URL query values in source metadata and markdown", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/a?token=secret-token&title=kept",
      fetchUrl: async () => response({ url: "https://www.example.com/b?signature=secret-signature&page=1" }),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.message)
    expect(result.source.originalUrl).toBe("https://example.com/a?token=%5Bredacted%5D&title=kept")
    expect(result.source.finalUrl).toBe("https://www.example.com/b?signature=%5Bredacted%5D&page=1")
    expect(result.source.markdown).toContain('source_url: "https://example.com/a?token=%5Bredacted%5D&title=kept"')
    expect(result.source.markdown).toContain('source_final_url: "https://www.example.com/b?signature=%5Bredacted%5D&page=1"')
    expect(result.source.markdown).not.toContain("secret-token")
    expect(result.source.markdown).not.toContain("secret-signature")
  })

  it("rejects unsupported protocols before fetching", async () => {
    const fetchUrl = vi.fn<FetchUrl>()

    for (const url of ["file:///tmp/source.html", "data:text/html,hi", "javascript:alert(1)"]) {
      const result = await acquireUrlSource({
        url,
        fetchUrl,
        now: () => new Date("2026-05-24T00:00:00.000Z"),
      })

      expect(result).toMatchObject({ ok: false, code: "unsupported_protocol" })
    }
    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it("rejects URL credentials before fetching", async () => {
    const fetchUrl = vi.fn<FetchUrl>()

    const result = await acquireUrlSource({
      url: "https://user:pass@example.com/a",
      fetchUrl,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: false, code: "url_credentials" })
    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it("rejects localhost and private URL hosts by default", async () => {
    const fetchUrl = vi.fn<FetchUrl>()

    for (const url of [
      "http://localhost:3000/a",
      "https://100.64.0.1/a",
      "https://100.127.255.255/a",
      "https://192.168.0.4/a",
    ]) {
      await expect(acquireUrlSource({
        url,
        fetchUrl,
        now: () => new Date("2026-05-24T00:00:00.000Z"),
      })).resolves.toMatchObject({ ok: false, code: "local_or_private_host" })
    }

    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it("rejects IPv4-mapped IPv6 loopback and private hosts before fetching", async () => {
    const fetchUrl = vi.fn<FetchUrl>()

    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[::ffff:100.64.0.1]/",
      "http://[::ffff:100.127.255.255]/",
      "http://[::ffff:172.16.0.1]/",
      "http://[::ffff:172.31.255.255]/",
      "http://[::ffff:192.168.0.1]/",
    ]) {
      await expect(acquireUrlSource({
        url,
        fetchUrl,
        now: () => new Date("2026-05-24T00:00:00.000Z"),
      })).resolves.toMatchObject({ ok: false, code: "local_or_private_host" })
    }

    expect(fetchUrl).not.toHaveBeenCalled()
  })

  it("rejects private final URLs returned by the injected fetch", async () => {
    const discard = vi.fn()
    const result = await acquireUrlSource({
      url: "https://example.com/a",
      fetchUrl: async () => response({ url: "http://192.168.0.2/a", discard }),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: false, code: "local_or_private_host" })
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it("rejects oversized responses", async () => {
    const discard = vi.fn()
    const result = await acquireUrlSource({
      url: "https://example.com/large",
      fetchUrl: async () => response({
        contentLength: "6",
        body: "abcdef",
        discard,
      }),
      maxBytes: 5,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: false, code: "size_limit_exceeded" })
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it("discards HTTP error response bodies without reading them", async () => {
    const discard = vi.fn()
    const text = vi.fn(async () => "not found")
    const result = await acquireUrlSource({
      url: "https://example.com/missing",
      fetchUrl: async () => ({
        ...response({ status: 404, discard }),
        text,
      }),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: false, code: "http_error" })
    expect(discard).toHaveBeenCalledTimes(1)
    expect(text).not.toHaveBeenCalled()
  })

  it("rejects oversized bodies without content-length", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/large",
      fetchUrl: async () => response({
        body: "abcdef",
      }),
      maxBytes: 5,
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: false, code: "size_limit_exceeded" })
  })

  it("rejects unsupported content types", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/image.png",
      fetchUrl: async () => response({
        contentType: "image/png",
        body: "not really an image",
      }),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: false, code: "unsupported_content_type" })
  })

  it("accepts text-looking responses with missing content type", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/note",
      fetchUrl: async () => response({
        contentType: null,
        body: "Plain source text.",
      }),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.message)
    expect(result.source.contentType).toBe("text/plain")
    expect(result.source.markdown).toContain("Plain source text.")
  })

  it("rejects binary-looking responses with missing content type", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/file",
      fetchUrl: async () => response({
        contentType: null,
        body: "\u0000PNG\r\n\u001a\nbinary",
      }),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toEqual({
      ok: false,
      code: "unsupported_content_type",
      message: "URL content type is missing and the response does not look like text.",
    })
  })

  it("removes script and style content from HTML markdown", async () => {
    const result = await acquireUrlSource({
      url: "https://example.com/a",
      fetchUrl: async () => response({
        body: "<html><head><style>.x{color:red}</style><script>alert(1)</script></head><body><h1>Kept</h1></body></html>",
      }),
      now: () => new Date("2026-05-24T00:00:00.000Z"),
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error(result.message)
    expect(result.source.markdown).toContain("# Kept")
    expect(result.source.markdown).not.toContain("alert")
    expect(result.source.markdown).not.toContain("color:red")
  })

  it("escapes URL frontmatter values", async () => {
    const frontmatter = sourceUrlFrontmatter({
      sourceUrl: 'https://example.com/a?title="quoted"',
      sourceFinalUrl: 'https://example.com/a?title="quoted"',
      fetchedAt: "2026-05-24T00:00:00.000Z",
      contentType: 'text/html"; charset="utf-8',
    })

    expect(frontmatter).toContain('source_url: "https://example.com/a?title=%22quoted%22"')
    expect(frontmatter).toContain('content_type: "text/html\\"; charset=\\"utf-8"')
  })

  it("redacts sensitive URL query values when serializing frontmatter directly", async () => {
    const frontmatter = sourceUrlFrontmatter({
      sourceUrl: "https://example.com/a?code=secret-code&title=kept",
      sourceFinalUrl: "https://example.com/a?signature=secret-signature",
      fetchedAt: "2026-05-24T00:00:00.000Z",
      contentType: "text/html",
    })

    expect(frontmatter).toContain('source_url: "https://example.com/a?code=%5Bredacted%5D&title=kept"')
    expect(frontmatter).toContain('source_final_url: "https://example.com/a?signature=%5Bredacted%5D"')
    expect(frontmatter).not.toContain("secret-code")
    expect(frontmatter).not.toContain("secret-signature")
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
