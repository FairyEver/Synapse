import { describe, expect, it, vi } from "vitest"
import { DrivePublicController, DriveUserController } from "./drive.controller"

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
    const exporter = { export: vi.fn(async (input: { resolveSource: () => Promise<typeof source> }) => {
      await input.resolveSource()
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
      { user: { id: "user-1" } } as never,
      response as never,
    )

    expect(drive.resolveOwnerMarkdownPdfSource).toHaveBeenCalledWith({
      userId: "user-1",
      itemId: "item-1",
      maxBytes: 10 * 1024 * 1024,
      maxImages: 256,
    })
    expect(exporter.export).toHaveBeenCalledWith({
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
    const exporter = { export: vi.fn(async (input: { resolveSource: () => Promise<typeof source> }) => {
      await input.resolveSource()
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
      { ip: "203.0.113.10", headers: {} } as never,
      response as never,
    )

    expect(drive.resolveShareMarkdownPdfSource).toHaveBeenCalledWith({
      shareId: "share-1",
      itemId: "item-1",
      cookie: undefined,
      maxBytes: 10 * 1024 * 1024,
      maxImages: 256,
    })
    expect(exporter.export).toHaveBeenCalledWith({
      rateLimitKey: "share-ip:203.0.113.10",
      resolveSource: expect.any(Function),
    })
  })
})

function createResponse() {
  const response = {
    headers: {} as Record<string, string>,
    setHeader: vi.fn((name: string, value: string) => {
      response.headers[name] = value
      return response
    }),
    status: vi.fn(() => response),
    send: vi.fn(() => response),
  }
  return response
}
