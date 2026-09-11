import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import { DrivePublicController, DriveUserController } from "./drive.controller"
import { DriveMarkdownPdfExportCancelledError } from "./drive-markdown-pdf-export.service"

const source = {
  itemId: "item-1",
  name: "说明.md",
  sourceText: "# 说明",
  allowStandaloneRawImages: true,
  relativeImages: new Map(),
}
const pdf = {
  bytes: Buffer.from("%PDF-test"),
  fileName: "说明.pdf",
  imageWarnings: 1,
  diagramWarnings: 2,
}

describe("Drive Markdown PDF export controllers", () => {
  it("exports an owned Markdown item with download headers", async () => {
    const drive = { resolveOwnerMarkdownPdfSource: vi.fn(async () => source) }
    const exporter = { export: vi.fn(async (input: { signal: AbortSignal; resolveSource: (signal: AbortSignal) => Promise<typeof source> }) => {
      await input.resolveSource(input.signal)
      return pdf
    }) }
    const controller = new DriveUserController(
      drive as never,
      undefined,
      undefined,
      undefined,
      undefined,
      exporter as never,
    )
    const response = createResponse()

    await controller.exportOwnerItemPdf(
      "item-1",
      createRequest({ user: { id: "user-1" } }) as never,
      response as never,
    )

    expect(drive.resolveOwnerMarkdownPdfSource).toHaveBeenCalledWith({
      userId: "user-1",
      itemId: "item-1",
      maxBytes: 10 * 1024 * 1024,
      maxImages: 256,
      signal: expect.anything(),
    })
    expect(exporter.export).toHaveBeenCalledWith({
      signal: expect.anything(),
      rateLimitKey: "user:user-1",
      resolveSource: expect.any(Function),
    })
    expect(response.headers["Content-Type"]).toBe("application/pdf")
    expect(response.headers["Content-Disposition"]).toContain("attachment")
    expect(response.headers["Content-Disposition"]).toContain("%E8%AF%B4%E6%98%8E.pdf")
    expect(response.headers["Cache-Control"]).toBe("private, no-store")
    expect(response.headers["X-Synapse-Pdf-Image-Warnings"]).toBe("1")
    expect(response.headers["X-Synapse-Pdf-Diagram-Warnings"]).toBe("2")
    expect(response.send).toHaveBeenCalledWith(pdf.bytes)
  })

  it("routes a shared child through share access resolution", async () => {
    const drive = { resolveShareMarkdownPdfSource: vi.fn(async () => source) }
    const exporter = { export: vi.fn(async (input: { signal: AbortSignal; resolveSource: (signal: AbortSignal) => Promise<typeof source> }) => {
      await input.resolveSource(input.signal)
      return pdf
    }) }
    const controller = new DrivePublicController(
      drive as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      exporter as never,
    )
    const response = createResponse()

    await controller.exportShareItemPdf(
      "share-1",
      "item-1",
      createRequest({ ip: "203.0.113.10", headers: {} }) as never,
      response as never,
    )

    expect(drive.resolveShareMarkdownPdfSource).toHaveBeenCalledWith({
      shareId: "share-1",
      itemId: "item-1",
      cookie: undefined,
      maxBytes: 10 * 1024 * 1024,
      maxImages: 256,
      signal: expect.anything(),
    })
    expect(exporter.export).toHaveBeenCalledWith({
      signal: expect.anything(),
      rateLimitKey: "share-ip:203.0.113.10",
      resolveSource: expect.any(Function),
    })
  })

  it("rate limits a shared export by user when the visitor is signed in", async () => {
    const drive = { resolveShareMarkdownPdfSource: vi.fn(async () => source) }
    const exporter = { export: vi.fn(async () => pdf) }
    const userAuth = { verifyAccessToken: vi.fn(async () => ({ userId: "reader-1" })) }
    const controller = new DrivePublicController(
      drive as never,
      {} as never,
      undefined,
      userAuth as never,
      undefined,
      undefined,
      undefined,
      undefined,
      exporter as never,
    )
    const response = createResponse()

    await controller.exportShareRootPdf(
      "share-1",
      createRequest({
        ip: "203.0.113.10",
        headers: { authorization: "Bearer access-token" },
      }) as never,
      response as never,
    )

    expect(userAuth.verifyAccessToken).toHaveBeenCalledWith("access-token")
    expect(exporter.export).toHaveBeenCalledWith({
      signal: expect.anything(),
      rateLimitKey: "user:reader-1",
      resolveSource: expect.any(Function),
    })
  })

  it("cancels an export without writing a response when the client disconnects", async () => {
    let exportSignal: AbortSignal | undefined
    const exporter = { export: vi.fn((input: { signal: AbortSignal }) => {
      exportSignal = input.signal
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new DriveMarkdownPdfExportCancelledError()), { once: true })
      })
    }) }
    const controller = new DriveUserController(
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      exporter as never,
    )
    const request = createRequest({ user: { id: "user-1" } })
    const response = createResponse()

    const operation = controller.exportOwnerItemPdf("item-1", request as never, response as never)
    request.emit("aborted")
    await operation

    expect(exportSignal?.aborted).toBe(true)
    expect(response.send).not.toHaveBeenCalled()
  })
})

function createRequest(properties: Record<string, unknown>) {
  return Object.assign(new EventEmitter(), { aborted: false }, properties)
}

function createResponse() {
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    headers: {} as Record<string, string>,
    setHeader: vi.fn((name: string, value: string) => {
      response.headers[name] = value
      return response
    }),
    status: vi.fn(() => response),
    send: vi.fn(() => {
      response.writableEnded = true
      return response
    }),
  })
  return response
}
