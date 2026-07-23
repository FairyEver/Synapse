import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../../electron/runtime/ipc/types"
import { TextFileWriteError } from "../../../text-file-writer/shared/errors"
import { HtmlGenerationError } from "../../shared/errors"
import { htmlGeneratorIpcModule } from "../ipc"

const electron = vi.hoisted(() => ({ showSaveDialog: vi.fn() }))

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => undefined,
    getAllWindows: () => [],
  },
  dialog: electron,
}))

const outputPath = path.resolve("report.html")

describe("htmlGeneratorIpcModule", () => {
  beforeEach(() => vi.clearAllMocks())

  it("declares strict generation schemas and an HTML-only save dialog", async () => {
    expect(htmlGeneratorIpcModule.id).toBe("htmlGenerator")
    expect(htmlGeneratorIpcModule.methods.generateHtml.request.safeParse({
      template: "<%= data.title %>",
      data: { title: "Report" },
      mode: "file",
    }).success).toBe(false)

    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: outputPath })
    await expect(htmlGeneratorIpcModule.methods.chooseOutput.handler(createContext(), undefined))
      .resolves.toBe(outputPath)
    expect(electron.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "output.html",
      filters: [{ name: "HTML 文件", extensions: ["html", "htm"] }],
    }))
  })

  it("uses independent sender cancellation and normalized responses", async () => {
    let destroy: (() => void) | undefined
    const detach = vi.fn()
    const generate = vi.fn(async (_input, context) => {
      expect(context.abortSignal.aborted).toBe(false)
      destroy?.()
      expect(context.abortSignal.aborted).toBe(true)
      throw new HtmlGenerationError("RENDER_CANCELLED")
    })
    const context = createContext({ "core.html-generator": { generate } }, {
      onDestroyed: (listener) => {
        destroy = listener
        return detach
      },
      isDestroyed: () => false,
    })

    await expect(htmlGeneratorIpcModule.methods.generateHtml.handler(context, {
      template: "<%= data.title %>",
      data: { title: "Report" },
    })).resolves.toEqual({
      ok: false,
      error: {
        code: "RENDER_CANCELLED",
        message: "HTML 生成已取消。",
        retryable: false,
      },
    })
    expect(detach).toHaveBeenCalledOnce()
  })

  it("preserves Writer errors for file generation", async () => {
    const generateToFile = vi.fn(async () => {
      throw new TextFileWriteError("TARGET_EXISTS")
    })
    const context = createContext({ "core.html-generator-file": { generateToFile } })

    await expect(htmlGeneratorIpcModule.methods.generateFile.handler(context, {
      template: "<%= data.title %>",
      data: { title: "Report" },
      outputPath,
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

function createContext(
  services: Record<string, unknown> = {},
  sender?: IpcHandlerContext["sender"],
): IpcHandlerContext {
  return {
    resolve: <T>(serviceId: string) => services[serviceId] as T,
    sender,
  }
}
