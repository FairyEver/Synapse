import { describe, expect, it, vi } from "vitest"
import { createDocumentTemplateCapabilityDispatcher } from "../dispatcher"

describe("createDocumentTemplateCapabilityDispatcher", () => {
  it("dispatches document template generation to the service", async () => {
    const generateDocx = vi.fn(async () => ({
      outputPath: "/tmp/output.docx",
      fileName: "output.docx",
      size: 123,
      generatedAt: "2026-06-23T00:00:00.000Z",
    }))
    const dispatcher = createDocumentTemplateCapabilityDispatcher({
      service: { generateDocx },
    })
    const params = {
      templatePath: "/tmp/template.docx",
      outputPath: "/tmp/output.docx",
      data: { name: "Ada" },
    }

    await expect(dispatcher.dispatch("app.document_template.docx.generate", params, { source: "mcp-http" })).resolves.toEqual({
      ok: true,
      data: {
        outputPath: "/tmp/output.docx",
        fileName: "output.docx",
        size: 123,
        generatedAt: "2026-06-23T00:00:00.000Z",
      },
      affected: 1,
    })
    expect(generateDocx).toHaveBeenCalledWith(params)
  })

  it("rejects unknown actions", async () => {
    const dispatcher = createDocumentTemplateCapabilityDispatcher({
      service: { generateDocx: vi.fn() },
    })

    await expect(dispatcher.dispatch("app.missing.generate", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown document template action")
  })
})
