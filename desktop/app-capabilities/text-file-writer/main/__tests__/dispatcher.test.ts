import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { TextFileWriteError } from "../../shared/errors"
import { createTextFileWriterCapabilityDispatcher } from "../dispatcher"

const outputPath = path.resolve("report.md")

describe("createTextFileWriterCapabilityDispatcher", () => {
  it("passes one complete request and dispatch identity to the shared service", async () => {
    const result = {
      path: outputPath,
      fileName: "report.md",
      format: "md" as const,
      encoding: "utf8" as const,
      size: 5,
      overwritten: false,
    }
    const write = vi.fn(async () => result)
    const dispatcher = createTextFileWriterCapabilityDispatcher({ service: { write } as never })
    const params = { text: "hello", path: outputPath }
    const abortSignal = new AbortController().signal
    const context = {
      source: "mcp-http" as const,
      actor: { kind: "user" as const, id: "mcp-client" },
      abortSignal,
    }

    await expect(dispatcher.dispatch("app.text_file_writer.file.write", params, context)).resolves.toEqual({
      ok: true,
      data: result,
      affected: 1,
    })
    expect(write).toHaveBeenCalledWith(params, {
      actor: context.actor,
      source: context.source,
      abortSignal,
    })
  })

  it("returns the stable error payload without content or native details", async () => {
    const write = vi.fn(async () => { throw new TextFileWriteError("TARGET_CHANGED") })
    const dispatcher = createTextFileWriterCapabilityDispatcher({ service: { write } as never })

    const response = await dispatcher.dispatch("app.text_file_writer.file.write", {
      text: "private body",
      path: outputPath,
      overwrite: true,
    }, { source: "mcp-stdio" })

    expect(response).toEqual({
      ok: false,
      code: "TARGET_CHANGED",
      error: "目标文件已发生变化，请重试。",
      data: {
        code: "TARGET_CHANGED",
        message: "目标文件已发生变化，请重试。",
        retryable: true,
      },
    })
    expect(JSON.stringify(response)).not.toContain("private body")
    expect(JSON.stringify(response)).not.toContain(outputPath)
  })

  it("rejects unknown actions", async () => {
    const dispatcher = createTextFileWriterCapabilityDispatcher({ service: { write: vi.fn() } as never })
    await expect(dispatcher.dispatch("app.unknown.file.write", {}, {}))
      .rejects.toThrow("Unknown text file writer action")
  })
})
