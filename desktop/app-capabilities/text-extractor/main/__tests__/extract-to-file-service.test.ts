import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { TextExtractionError } from "../../shared/errors"
import { createTextExtractionToFileService } from "../extract-to-file-service"
import { textExtractionToFileInputSchema } from "../../shared/schema"

const filePath = path.resolve("source.pdf")
const outputPath = path.resolve("source.pdf.extracted.md")

describe("TextExtractionToFileService", () => {
  it("keeps the composition output contract restricted to txt, md, and csv", () => {
    expect(textExtractionToFileInputSchema.safeParse({ filePath, outputPath: path.resolve("report.md") }).success).toBe(true)
    expect(textExtractionToFileInputSchema.safeParse({ filePath, outputPath: path.resolve("report.html") }).success).toBe(false)
  })

  it("keeps extracted text inside the service boundary and returns metadata only", async () => {
    const text = "完整正文"
    const extract = vi.fn(async () => ({
      text,
      format: "pdf" as const,
      fileName: "source.pdf",
      size: 123,
      pages: 2,
    }))
    const write = vi.fn(async () => ({
      path: outputPath,
      fileName: "source.pdf.extracted.md",
      format: "md" as const,
      encoding: "utf8" as const,
      size: Buffer.byteLength(text),
      overwritten: true,
    }))
    const service = createTextExtractionToFileService({
      extractor: { extract },
      writer: { write },
    })
    const context = {
      source: "mcp-http" as const,
      actor: { kind: "user" as const, id: "mcp-client:test" },
      clientId: "mcp-install:test",
      controllerInstanceId: "controller:test",
    }

    const result = await service.extractToFile({
      filePath,
      outputPath,
      overwrite: true,
    }, context)

    expect(extract).toHaveBeenCalledWith({ filePath }, context)
    expect(write).toHaveBeenCalledWith({
      path: outputPath,
      text,
      encoding: "utf8",
      overwrite: true,
    }, {
      actor: context.actor,
      source: context.source,
      metadata: {
        parentCapability: "app.text_extractor.document.extract_to_file",
        clientId: "mcp-install:test",
        controllerInstanceId: "controller:test",
      },
    })
    expect(result).toEqual({
      source: {
        format: "pdf",
        fileName: "source.pdf",
        size: 123,
        pages: 2,
      },
      output: {
        path: outputPath,
        fileName: "source.pdf.extracted.md",
        format: "md",
        encoding: "utf8",
        size: Buffer.byteLength(text),
        overwritten: true,
      },
    })
    expect(result).not.toHaveProperty("text")
    expect(result.source).not.toHaveProperty("text")
  })

  it("does not write when extraction fails", async () => {
    const write = vi.fn()
    const service = createTextExtractionToFileService({
      extractor: {
        extract: vi.fn(async () => {
          throw new TextExtractionError("INVALID_DOCUMENT")
        }),
      },
      writer: { write },
    })

    await expect(service.extractToFile({ filePath, outputPath }))
      .rejects.toMatchObject({ code: "INVALID_DOCUMENT" })
    expect(write).not.toHaveBeenCalled()
  })
})
