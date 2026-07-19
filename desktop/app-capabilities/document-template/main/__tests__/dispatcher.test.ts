import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createDocumentTemplateCapabilityDispatcher } from "../dispatcher"

const templatePath = path.resolve("template.docx")
const outputPath = path.resolve("output.docx")
const dataPath = path.resolve("data.json")

describe("createDocumentTemplateCapabilityDispatcher", () => {
  it("dispatches document template generation to the service", async () => {
    const generateDocx = vi.fn(async () => ({
      outputPath,
      fileName: "output.docx",
      size: 123,
      generatedAt: "2026-06-23T00:00:00.000Z",
    }))
    const dispatcher = createDocumentTemplateCapabilityDispatcher({
      service: { generateDocx },
    })
    const params = {
      templatePath,
      outputPath,
      data: { name: "Ada" },
    }

    await expect(dispatcher.dispatch("app.document_template.docx.generate", params, { source: "mcp-http" })).resolves.toEqual({
      ok: true,
      data: {
        outputPath,
        fileName: "output.docx",
        size: 123,
        generatedAt: "2026-06-23T00:00:00.000Z",
      },
      affected: 1,
    })
    expect(generateDocx).toHaveBeenCalledWith(params)
  })

  it("checks file permissions before dispatching", async () => {
    const generateDocx = vi.fn(async () => ({
      outputPath,
      fileName: "output.docx",
      size: 123,
      generatedAt: "2026-06-23T00:00:00.000Z",
    }))
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const auditSink = {
      record: vi.fn(),
    }
    const dispatcher = createDocumentTemplateCapabilityDispatcher({
      service: { generateDocx },
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await dispatcher.dispatch("app.document_template.docx.generate", {
      templatePath,
      outputPath,
      dataPath,
    }, { source: "mcp-http" })

    expect(permissionGuard.check).toHaveBeenCalledTimes(3)
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: templatePath,
    }))
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: dataPath,
    }))
    expect(permissionGuard.check).toHaveBeenNthCalledWith(3, expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: outputPath,
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "allowed" }))
  })

  it("rejects relative paths before permission checks", async () => {
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true as const })) }
    const dispatcher = createDocumentTemplateCapabilityDispatcher({
      service: { generateDocx: vi.fn() },
      permissionGuard: permissionGuard as never,
      auditSink: { record: vi.fn() } as never,
    })

    await expect(dispatcher.dispatch("app.document_template.docx.generate", {
      templatePath: "template.docx",
      outputPath,
      data: { name: "Ada" },
    }, { source: "mcp-http" })).rejects.toThrow("必须使用绝对路径")
    expect(permissionGuard.check).not.toHaveBeenCalled()
  })

  it("rejects unknown actions", async () => {
    const dispatcher = createDocumentTemplateCapabilityDispatcher({
      service: { generateDocx: vi.fn() },
    })

    await expect(dispatcher.dispatch("app.missing.generate", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown document template action")
  })

  it("rejects denied file permissions", async () => {
    const dispatcher = createDocumentTemplateCapabilityDispatcher({
      service: { generateDocx: vi.fn() },
      permissionGuard: {
        check: vi.fn(async () => ({ allowed: false as const, reason: "denied", policyId: "test" })),
      } as never,
      auditSink: { record: vi.fn() } as never,
    })

    await expect(dispatcher.dispatch("app.document_template.docx.generate", {
      templatePath,
      outputPath,
      data: { name: "Ada" },
    }, { source: "mcp-http" })).rejects.toThrow("denied")
  })
})
