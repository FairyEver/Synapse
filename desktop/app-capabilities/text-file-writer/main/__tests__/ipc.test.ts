import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../../electron/runtime/ipc/types"
import { TextFileWriteError } from "../../shared/errors"
import { textFileWriterIpcModule } from "../ipc"

const electron = vi.hoisted(() => ({ showSaveDialog: vi.fn() }))

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => undefined,
    getAllWindows: () => [],
  },
  dialog: electron,
}))

const outputPath = path.resolve("report.md")

describe("textFileWriterIpcModule", () => {
  beforeEach(() => vi.clearAllMocks())

  it("declares strict schemas with no text length limit", () => {
    expect(textFileWriterIpcModule.id).toBe("textFileWriter")
    expect(textFileWriterIpcModule.methods.chooseOutput.operationId).toBe("app.text_file_writer.output.choose")
    expect(textFileWriterIpcModule.methods.writeFile.operationId).toBe("app.text_file_writer.file.write")
    expect(textFileWriterIpcModule.methods.writeFile.request.safeParse({
      text: "x".repeat(2_000_000),
      path: outputPath,
    }).success).toBe(true)
    expect(textFileWriterIpcModule.methods.writeFile.request.safeParse({
      text: "hello",
      path: outputPath,
      format: "md",
    }).success).toBe(false)
  })

  it("filters the native dialog without inferring overwrite", async () => {
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: outputPath })

    await expect(textFileWriterIpcModule.methods.chooseOutput.handler(createContext(), {
      defaultPath: "output.md",
    })).resolves.toBe(outputPath)
    expect(electron.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "output.md",
      filters: [{ name: "文本文件", extensions: ["txt", "md", "csv"] }],
    }))
  })

  it("returns unified success and failure envelopes", async () => {
    const write = vi.fn(async () => ({
      path: outputPath,
      fileName: "report.md",
      format: "md" as const,
      encoding: "utf8" as const,
      size: 5,
      overwritten: false,
    }))
    const context = createContext({ "core.text-file-writer": { write } })

    await expect(textFileWriterIpcModule.methods.writeFile.handler(context, {
      text: "hello",
      path: outputPath,
    })).resolves.toMatchObject({ ok: true, result: { path: outputPath } })
    expect(write).toHaveBeenCalledWith({ text: "hello", path: outputPath }, {
      actor: { kind: "user", id: "text-file-writer-app" },
      source: "app.ui",
    })

    write.mockRejectedValueOnce(new TextFileWriteError("TARGET_EXISTS") as never)
    await expect(textFileWriterIpcModule.methods.writeFile.handler(context, {
      text: "hello",
      path: outputPath,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "TARGET_EXISTS",
        message: "目标文件已存在，请启用覆盖后重试。",
        retryable: false,
      },
    })
  })
})

function createContext(services: Record<string, unknown> = {}): IpcHandlerContext {
  return {
    resolve: <T>(serviceId: string) => services[serviceId] as T,
  }
}
