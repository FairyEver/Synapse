import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createHtmlGenerationToFileService } from "../file-service"

describe("HTML Generation to file composition", () => {
  it("renders first, then delegates exact UTF-8 HTML to the shared Writer", async () => {
    const outputPath = path.resolve("report.HTML")
    const generateForOperation = vi.fn(async () => ({ html: "<h1>报告</h1>", size: 15 }))
    const write = vi.fn(async () => ({
      path: outputPath,
      fileName: "report.HTML",
      format: "html" as const,
      encoding: "utf8" as const,
      size: 15,
      overwritten: false,
    }))
    const service = createHtmlGenerationToFileService({ generator: { generateForOperation }, writer: { write } })
    const context = {
      actor: { kind: "user" as const, id: "test" },
      source: "workflow" as const,
      metadata: { runId: "run-1" },
    }

    const result = await service.generateToFile({
      template: "<h1><%= data.title %></h1>",
      data: { title: "报告" },
      outputPath,
    }, context)

    expect(result).toEqual({
      output: {
        path: outputPath,
        fileName: "report.HTML",
        format: "html",
        encoding: "utf8",
        size: 15,
        overwritten: false,
      },
    })

    expect(generateForOperation).toHaveBeenCalledWith("ejs_file", {
      template: "<h1><%= data.title %></h1>",
      data: { title: "报告" },
    }, context)
    expect(write).toHaveBeenCalledWith({
      text: "<h1>报告</h1>",
      path: outputPath,
      encoding: "utf8",
      overwrite: false,
    }, expect.objectContaining({
      actor: context.actor,
      source: "workflow",
      metadata: { runId: "run-1", parentCapability: "app.html_generator.ejs_file.generate" },
    }))
  })

  it("does not call Writer when cancelled after rendering", async () => {
    const controller = new AbortController()
    const write = vi.fn()
    const service = createHtmlGenerationToFileService({
      generator: { generateForOperation: vi.fn(async () => {
        controller.abort()
        return { html: "ok", size: 2 }
      }) },
      writer: { write },
    })

    await expect(service.generateToFile({
      template: "ok",
      data: {},
      outputPath: path.resolve("out.html"),
    }, { abortSignal: controller.signal })).rejects.toEqual(expect.objectContaining({ code: "RENDER_CANCELLED" }))
    expect(write).not.toHaveBeenCalled()
  })

  it("validates the absolute HTML target before rendering", async () => {
    const generateForOperation = vi.fn(async () => ({ html: "ok", size: 2 }))
    const service = createHtmlGenerationToFileService({ generator: { generateForOperation }, writer: { write: vi.fn() } })

    await expect(service.generateToFile({ template: "ok", data: {}, outputPath: "relative.html" }))
      .rejects.toMatchObject({ code: "INVALID_PATH" })
    await expect(service.generateToFile({ template: "ok", data: {}, outputPath: path.resolve("out.txt") }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_EXTENSION" })
    expect(generateForOperation).not.toHaveBeenCalled()
  })
})
