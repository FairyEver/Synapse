import { afterEach, describe, expect, it, vi } from "vitest"
import { Readable } from "node:stream"
import {
  DriveMarkdownPdfExportCancelledError,
  DriveMarkdownPdfExportService,
} from "./drive-markdown-pdf-export.service"

vi.mock("./drive-markdown-pdf-render-worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./drive-markdown-pdf-render-worker")>()
  const { renderDriveMarkdownFragment } = await import("./drive-markdown-renderer.js")
  return {
    ...actual,
    renderDriveMarkdownPdfInWorker: (
      markdown: string,
      options: Parameters<typeof renderDriveMarkdownFragment>[1],
    ) => renderDriveMarkdownFragment(markdown, options),
  }
})

const originalEnv = { ...process.env }

describe("DriveMarkdownPdfExportService", () => {
  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
  })

  it("sends self-contained image HTML to the renderer and returns warning headers", async () => {
    process.env.PDF_RENDERER_URL = "http://pdf-renderer:3010"
    process.env.PDF_RENDERER_INTERNAL_SECRET = "test-pdf-renderer-secret-with-more-than-32-characters"
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test"
    process.env.ADMIN_ACCESS_SECRET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"
    process.env.USER_ACCESS_JWT_SECRET = "test-user-access-secret-with-more-than-32-characters"
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { html: string }
      expect(payload.html).toContain("data:image/png;base64,")
      expect(payload.html).not.toContain("https://")
      return new Response(Buffer.from("%PDF-test"), {
        status: 200,
        headers: {
          "X-Synapse-Pdf-Image-Warnings": "1",
          "X-Synapse-Pdf-Diagram-Warnings": "2",
        },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const service = new DriveMarkdownPdfExportService(
      {} as never,
      {} as never,
      {} as never,
    )
    const png = validPng()
    const result = await service.export({
      rateLimitKey: "user:test",
      resolveSource: async () => ({
        itemId: "item",
        name: "报告.md",
        sourceText: `![内嵌图](data:image/png;base64,${png.toString("base64")})\n\n![失败图](ftp://example.com/private.png)`,
        allowStandaloneRawImages: true,
        relativeImages: new Map(),
      }),
    })

    expect(result.fileName).toBe("报告.pdf")
    expect(result.imageWarnings).toBe(2)
    expect(result.diagramWarnings).toBe(2)
    expect(result.bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-")
  })

  it("resolves a repeated relative image only once", async () => {
    configureRendererEnv()
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { html: string }
      expect(payload.html.match(/data:image\/png;base64,/gu)).toHaveLength(1)
      expect(payload.html.match(/data-drive-pdf-resource-key="image-1"/gu)).toHaveLength(2)
      return new Response(Buffer.from("%PDF-test"), { status: 200 })
    }))
    const png = validPng()
    const getObjectStream = vi.fn(async () => ({ stream: Readable.from([png]), size: BigInt(png.length) }))
    const service = new DriveMarkdownPdfExportService(
      { getObjectStream } as never,
      {} as never,
      {} as never,
    )

    const result = await service.export({
      rateLimitKey: "user:duplicate",
      resolveSource: async () => ({
        itemId: "item",
        name: "重复图片.md",
        sourceText: "![第一处](image.png)\n\n![第二处](image.png)",
        allowStandaloneRawImages: true,
        relativeImages: new Map([["relative:image.png", {
          storageKey: "drive/image.png",
          size: BigInt(png.length),
          mimeType: "image/png",
        }]]),
      }),
    })

    expect(getObjectStream).toHaveBeenCalledTimes(1)
    expect(result.imageWarnings).toBe(0)
  })

  it("rejects an oversized image before opening storage", async () => {
    configureRendererEnv()
    const getObjectStream = vi.fn()
    const service = new DriveMarkdownPdfExportService(
      { getObjectStream } as never,
      {} as never,
      {} as never,
    )

    await expect(service.export({
      rateLimitKey: "user:oversized",
      resolveSource: async () => ({
        itemId: "item",
        name: "超大图片.md",
        sourceText: "![超大](image.png)",
        allowStandaloneRawImages: true,
        relativeImages: new Map([["relative:image.png", {
          storageKey: "drive/image.png",
          size: BigInt(10 * 1024 * 1024 + 1),
          mimeType: "image/png",
        }]]),
      }),
    })).rejects.toMatchObject({ status: 413 })
    expect(getObjectStream).not.toHaveBeenCalled()
  })

  it("counts invalid image bytes toward the aggregate image budget", async () => {
    configureRendererEnv()
    const invalidBytes = Buffer.alloc(10 * 1024 * 1024)
    const getObjectStream = vi.fn(async () => ({
      stream: Readable.from([invalidBytes]),
      size: BigInt(invalidBytes.length),
    }))
    const service = new DriveMarkdownPdfExportService(
      { getObjectStream } as never,
      {} as never,
      {} as never,
    )
    const imageNames = Array.from({ length: 7 }, (_, index) => `invalid-${index}.png`)

    await expect(service.export({
      rateLimitKey: "user:invalid-image-budget",
      resolveSource: async () => ({
        itemId: "item",
        name: "失败图片.md",
        sourceText: imageNames.map((name, index) => `![失败 ${index}](${name})`).join("\n"),
        allowStandaloneRawImages: true,
        relativeImages: new Map(imageNames.map((name) => [`relative:${name}`, {
          storageKey: `drive/${name}`,
          size: BigInt(invalidBytes.length),
          mimeType: "image/png",
        }])),
      }),
    })).rejects.toMatchObject({ status: 413 })
    expect(getObjectStream).toHaveBeenCalledTimes(7)
  })

  it("maps a saturated renderer queue to 429", async () => {
    configureRendererEnv()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429 })))
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)

    await expect(service.export({
      rateLimitKey: "user:queue",
      resolveSource: async () => emptySource("queue.md"),
    })).rejects.toMatchObject({ status: 429 })
  })

  it("maps a renderer timeout to 504", async () => {
    configureRendererEnv()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 504 })))
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)

    await expect(service.export({
      rateLimitKey: "user:renderer-timeout",
      resolveSource: async () => emptySource("timeout.md"),
    })).rejects.toMatchObject({ status: 504 })
  })

  it("maps a renderer request-size rejection to 413", async () => {
    configureRendererEnv()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 413 })))
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)

    await expect(service.export({
      rateLimitKey: "user:renderer-request-size",
      resolveSource: async () => emptySource("oversized-request.md"),
    })).rejects.toMatchObject({ status: 413 })
  })

  it("cancels a renderer response whose declared PDF size exceeds the limit", async () => {
    configureRendererEnv()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "Content-Length": String(64 * 1024 * 1024 + 1) },
    })))
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)

    await expect(service.export({
      rateLimitKey: "user:oversized-renderer-response",
      resolveSource: async () => emptySource("oversized-response.md"),
    })).rejects.toMatchObject({ status: 413 })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("limits one rate-limit key to five exports per minute", async () => {
    configureRendererEnv()
    const render = vi.fn(async () => new Response(Buffer.from("%PDF-test"), { status: 200 }))
    const resolveSource = vi.fn(async () => emptySource("limit.md"))
    vi.stubGlobal("fetch", render)
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)

    for (let index = 0; index < 5; index += 1) {
      await service.export({ rateLimitKey: "user:limited", resolveSource })
    }
    await expect(service.export({
      rateLimitKey: "user:limited",
      resolveSource,
    })).rejects.toMatchObject({ status: 429 })
    expect(render).toHaveBeenCalledTimes(5)
    expect(resolveSource).toHaveBeenCalledTimes(5)
  })

  it("includes source resolution in the sixty-second deadline", async () => {
    vi.useFakeTimers()
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)
    const operation = service.export({
      rateLimitKey: "user:source-timeout",
      resolveSource: () => new Promise(() => undefined),
    })
    const rejection = expect(operation).rejects.toMatchObject({ status: 504 })

    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
  })

  it("cancels source resolution when the HTTP client disconnects", async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)
    const operation = service.export({
      signal: controller.signal,
      rateLimitKey: "user:client-disconnect",
      resolveSource: (signal) => {
        receivedSignal = signal
        return new Promise(() => undefined)
      },
    })

    controller.abort()

    await expect(operation).rejects.toBeInstanceOf(DriveMarkdownPdfExportCancelledError)
    expect(receivedSignal?.aborted).toBe(true)
  })

  it("does not consume rate limit or resolve a source for an already disconnected client", async () => {
    const controller = new AbortController()
    controller.abort()
    const resolveSource = vi.fn(async () => emptySource("cancelled.md"))
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)

    await expect(service.export({
      signal: controller.signal,
      rateLimitKey: "user:already-disconnected",
      resolveSource,
    })).rejects.toBeInstanceOf(DriveMarkdownPdfExportCancelledError)

    expect(resolveSource).not.toHaveBeenCalled()
  })

  it("ends the whole export after sixty seconds even when storage stalls", async () => {
    vi.useFakeTimers()
    const service = new DriveMarkdownPdfExportService(
      { getObjectStream: vi.fn(() => new Promise(() => undefined)) } as never,
      {} as never,
      {} as never,
    )
    const operation = service.export({
      rateLimitKey: "user:timeout",
      resolveSource: async () => ({
        itemId: "item",
        name: "超时.md",
        sourceText: "![超时](image.png)",
        allowStandaloneRawImages: true,
        relativeImages: new Map([["relative:image.png", {
          storageKey: "drive/image.png",
          size: 8n,
          mimeType: "image/png",
        }]]),
      }),
    })
    const rejection = expect(operation).rejects.toMatchObject({ status: 504 })

    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
  })

  it("aborts an open image stream when the export deadline expires", async () => {
    vi.useFakeTimers()
    const stream = new Readable({ read() {} })
    const destroy = vi.spyOn(stream, "destroy")
    const service = new DriveMarkdownPdfExportService(
      { getObjectStream: vi.fn(async () => ({ stream, size: 8n })) } as never,
      {} as never,
      {} as never,
    )
    const operation = service.export({
      rateLimitKey: "user:stream-timeout",
      resolveSource: async () => ({
        itemId: "item",
        name: "超时.md",
        sourceText: "![超时](image.png)",
        allowStandaloneRawImages: true,
        relativeImages: new Map([["relative:image.png", {
          storageKey: "drive/image.png",
          size: 8n,
          mimeType: "image/png",
        }]]),
      }),
    })
    const rejection = expect(operation).rejects.toMatchObject({ status: 504 })

    await vi.advanceTimersByTimeAsync(60_000)
    await rejection
    expect(destroy).toHaveBeenCalled()
  })

  it("removes the final extension from MIME-recognized Markdown filenames", async () => {
    configureRendererEnv()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ title: "report" })
      return new Response(Buffer.from("%PDF-test"), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)

    const result = await service.export({
      rateLimitKey: "user:mime-markdown",
      resolveSource: async () => emptySource("report.bin"),
    })

    expect(result.fileName).toBe("report.pdf")
  })

  it("does not split a Unicode surrogate pair when truncating the PDF filename", async () => {
    configureRendererEnv()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.from("%PDF-test"), { status: 200 })))
    const service = new DriveMarkdownPdfExportService({} as never, {} as never, {} as never)

    const result = await service.export({
      rateLimitKey: "user:unicode-name",
      resolveSource: async () => emptySource(`${"a".repeat(179)}😀.md`),
    })

    expect(result.fileName).toBe(`${"a".repeat(179)}😀.pdf`)
    expect(() => encodeURIComponent(result.fileName)).not.toThrow()
  })
})

function configureRendererEnv(): void {
  process.env.PDF_RENDERER_URL = "http://pdf-renderer:3010"
  process.env.PDF_RENDERER_INTERNAL_SECRET = "test-pdf-renderer-secret-with-more-than-32-characters"
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test"
  process.env.ADMIN_ACCESS_SECRET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"
  process.env.USER_ACCESS_JWT_SECRET = "test-user-access-secret-with-more-than-32-characters"
}

function emptySource(name: string) {
  return {
    itemId: "item",
    name,
    sourceText: "# 文档",
    allowStandaloneRawImages: true,
    relativeImages: new Map(),
  }
}

function validPng(): Buffer {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
}
