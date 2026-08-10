import { describe, expect, it, vi } from "vitest"
import type { DispatchContext } from "../../../../synapse-capabilities/shared/types"
import { TextFileWriteError } from "../../../text-file-writer/shared/errors"
import {
  HTML_GENERATOR_EJS_CAPABILITY_ID,
  HTML_GENERATOR_EJS_FILE_CAPABILITY_ID,
} from "../../shared/capability"
import { createHtmlGeneratorCapabilityDispatcher } from "../dispatcher"

const abortSignal = new AbortController().signal
const context: DispatchContext = {
  actor: { kind: "user", id: "mcp-user" },
  source: "mcp.http",
  abortSignal,
}

describe("HTML Generator capability dispatcher", () => {
  it("routes both independent capabilities to the shared services", async () => {
    const generate = vi.fn(async () => ({ html: "<h1>Report</h1>", size: 15 }))
    const generateToFile = vi.fn(async () => ({
      output: {
        path: "/tmp/report.html",
        fileName: "report.html",
        format: "html" as const,
        encoding: "utf8" as const,
        size: 15,
        overwritten: false,
      },
    }))
    const dispatcher = createHtmlGeneratorCapabilityDispatcher({
      generator: { generate } as never,
      fileGenerator: { generateToFile },
    })

    await expect(dispatcher.dispatch(HTML_GENERATOR_EJS_CAPABILITY_ID, {
      template: "<h1><%= data.title %></h1>",
      data: { title: "Report" },
    }, context)).resolves.toMatchObject({ ok: true, data: { html: "<h1>Report</h1>" } })
    await expect(dispatcher.dispatch(HTML_GENERATOR_EJS_FILE_CAPABILITY_ID, {
      template: "<h1><%= data.title %></h1>",
      data: { title: "Report" },
      outputPath: "/tmp/report.html",
    }, context)).resolves.toMatchObject({ ok: true, affected: 1 })
    expect(generate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ abortSignal }))
    expect(generateToFile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ abortSignal }))
  })

  it("preserves Writer errors instead of relabeling them", async () => {
    const dispatcher = createHtmlGeneratorCapabilityDispatcher({
      generator: { generate: vi.fn() } as never,
      fileGenerator: {
        generateToFile: vi.fn(async () => { throw new TextFileWriteError("TARGET_EXISTS") }),
      },
    })

    await expect(dispatcher.dispatch(HTML_GENERATOR_EJS_FILE_CAPABILITY_ID, {}, context)).resolves.toEqual({
      ok: false,
      code: "TARGET_EXISTS",
      error: "目标文件已存在，请启用覆盖后重试。",
      data: {
        code: "TARGET_EXISTS",
        message: "目标文件已存在，请启用覆盖后重试。",
        retryable: false,
      },
    })
  })
})
