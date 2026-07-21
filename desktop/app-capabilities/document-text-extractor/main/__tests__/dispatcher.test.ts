import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { DocumentTextExtractionError } from "../../shared/errors"
import { createDocumentTextExtractorCapabilityDispatcher } from "../dispatcher"

const filePath = path.resolve("private/report.pdf")

describe("createDocumentTextExtractorCapabilityDispatcher", () => {
  it("forwards the security context and returns the extraction result", async () => {
    const result = {
      text: "document text",
      format: "pdf" as const,
      fileName: "report.pdf",
      size: 123,
      pages: 2,
    }
    const extract = vi.fn(async () => result)
    const dispatcher = createDocumentTextExtractorCapabilityDispatcher({
      service: { extract },
    })
    const context = {
      source: "mcp-http" as const,
      actor: { kind: "user" as const, id: "mcp-client:test" },
    }

    await expect(dispatcher.dispatch(
      "app.document_text_extractor.document.extract",
      { filePath },
      context,
    )).resolves.toEqual({ ok: true, data: result, affected: 1 })
    expect(extract).toHaveBeenCalledWith({ filePath }, context)
  })

  it("serializes stable extraction failures without exposing the path", async () => {
    const dispatcher = createDocumentTextExtractorCapabilityDispatcher({
      service: {
        extract: vi.fn(async () => {
          throw new DocumentTextExtractionError("INVALID_DOCUMENT")
        }),
      },
    })

    const result = await dispatcher.dispatch(
      "app.document_text_extractor.document.extract",
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

})
