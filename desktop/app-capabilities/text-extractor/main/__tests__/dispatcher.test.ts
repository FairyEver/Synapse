import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { TextExtractionError } from "../../shared/errors"
import { TextFileWriteError } from "../../../text-file-writer/shared/errors"
import { createTextExtractorCapabilityDispatcher } from "../dispatcher"

const filePath = path.resolve("private/report.pdf")

describe("createTextExtractorCapabilityDispatcher", () => {
  it("forwards the security context and returns the extraction result", async () => {
    const result = {
      text: "document text",
      format: "pdf" as const,
      fileName: "report.pdf",
      size: 123,
      pages: 2,
    }
    const extract = vi.fn(async () => result)
    const dispatcher = createTextExtractorCapabilityDispatcher({
      service: { extract },
    })
    const context = {
      source: "mcp-http" as const,
      actor: { kind: "user" as const, id: "mcp-client:test" },
    }

    await expect(dispatcher.dispatch(
      "app.text_extractor.document.extract",
      { filePath },
      context,
    )).resolves.toEqual({ ok: true, data: result, affected: 1 })
    expect(extract).toHaveBeenCalledWith({ filePath }, context)
  })

  it("serializes stable extraction failures without exposing the path", async () => {
    const dispatcher = createTextExtractorCapabilityDispatcher({
      service: {
        extract: vi.fn(async () => {
          throw new TextExtractionError("INVALID_DOCUMENT")
        }),
      },
    })

    const result = await dispatcher.dispatch(
      "app.text_extractor.document.extract",
      { filePath },
      { source: "mcp-http" },
    )

    expect(result).toEqual({
      ok: false,
      code: "INVALID_DOCUMENT",
      error: "文档格式无效或文件已损坏。",
    })
    expect(JSON.stringify(result)).not.toContain(filePath)
  })

  it("returns the shared DOCX result without PDF-only pages", async () => {
    const docxPath = path.resolve("private/report.docx")
    const result = {
      text: "document text",
      format: "docx" as const,
      fileName: "report.docx",
      size: 456,
    }
    const dispatcher = createTextExtractorCapabilityDispatcher({
      service: { extract: vi.fn(async () => result) },
    })

    await expect(dispatcher.dispatch(
      "app.text_extractor.document.extract",
      { filePath: docxPath },
      { source: "mcp-http" },
    )).resolves.toEqual({ ok: true, data: result, affected: 1 })
  })

  it("returns only source and output metadata for direct extraction to file", async () => {
    const outputPath = path.resolve("private/report.pdf.extracted.md")
    const result = {
      source: {
        format: "pdf" as const,
        fileName: "report.pdf",
        size: 123,
        pages: 2,
      },
      output: {
        path: outputPath,
        fileName: "report.pdf.extracted.md",
        format: "md" as const,
        encoding: "utf8" as const,
        size: 42,
        overwritten: true,
      },
    }
    const extractToFile = vi.fn(async () => result)
    const dispatcher = createTextExtractorCapabilityDispatcher({
      service: { extract: vi.fn() },
      toFileService: { extractToFile },
    })
    const context = { source: "mcp-http" as const }

    await expect(dispatcher.dispatch(
      "app.text_extractor.document.extract_to_file",
      { filePath, outputPath, overwrite: true },
      context,
    )).resolves.toEqual({ ok: true, data: result, affected: 1 })
    expect(extractToFile).toHaveBeenCalledWith({
      filePath,
      outputPath,
      encoding: "utf8",
      overwrite: true,
    }, context)
    expect(JSON.stringify(result)).not.toContain("document text")
  })

  it("preserves direct-write error details without exposing file paths", async () => {
    const outputPath = path.resolve("private/report.pdf.extracted.md")
    const dispatcher = createTextExtractorCapabilityDispatcher({
      service: { extract: vi.fn() },
      toFileService: {
        extractToFile: vi.fn(async () => {
          throw new TextFileWriteError("TARGET_CHANGED")
        }),
      },
    })

    const result = await dispatcher.dispatch(
      "app.text_extractor.document.extract_to_file",
      { filePath, outputPath, overwrite: true },
      { source: "mcp-http" },
    )

    expect(result).toEqual({
      ok: false,
      code: "TARGET_CHANGED",
      error: "目标文件已发生变化，请重试。",
      data: {
        code: "TARGET_CHANGED",
        message: "目标文件已发生变化，请重试。",
        retryable: true,
      },
    })
    expect(JSON.stringify(result)).not.toContain(filePath)
    expect(JSON.stringify(result)).not.toContain(outputPath)
  })

})
