import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../../electron/runtime/ipc/types"
import { TextExtractionError } from "../../shared/errors"
import { createTextExtractorIpcModule } from "../ipc"

const electron = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => undefined,
    getAllWindows: () => [],
  },
  dialog: electron,
}))

const filePath = path.resolve("report.pdf")
const outputPath = path.resolve("report.txt")

describe("textExtractorIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("declares the document extraction IPC surface and validates requests", () => {
    const module = createTextExtractorIpcModule()

    expect(module.id).toBe("textExtractor")
    expect(module.methods.chooseDocument.operationId).toBe("app.text_extractor.document.choose")
    expect(module.methods.extractDocument.operationId).toBe("app.text_extractor.document.extract")
    expect(module.methods.cancelExtraction.operationId).toBe("app.text_extractor.operation.cancel")
    expect(module.methods.chooseOutput.operationId).toBe("app.text_extractor.output.choose")
    expect(module.methods.saveText.operationId).toBe("app.text_extractor.text.save")
    expect(module.events.status.operationId).toBe("app.text_extractor.operation.status")
    expect(module.methods.extractDocument.request.safeParse({ operationId: "run-1", filePath }).success).toBe(true)
    expect(module.methods.extractDocument.request.safeParse({ operationId: "run-1", filePath: "report.pdf" }).success).toBe(false)
    expect(module.methods.saveText.request.safeParse({ outputPath, text: "正文" }).success).toBe(true)
    expect(module.methods.saveText.request.safeParse({ outputPath: "report.txt", text: "正文" }).success).toBe(false)
  })

  it("uses the system dialogs for PDF/DOCX selection and TXT saving", async () => {
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] })
    electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath: outputPath })
    const module = createTextExtractorIpcModule()

    await expect(module.methods.chooseDocument.handler(createContext(), undefined)).resolves.toBe(filePath)
    await expect(module.methods.chooseOutput.handler(createContext(), { defaultPath: "report.txt" })).resolves.toBe(outputPath)

    expect(electron.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      filters: [{ name: "PDF 或 Word 文档", extensions: ["pdf", "docx"] }],
      properties: ["openFile"],
    }))
    expect(electron.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "report.txt",
      filters: [{ name: "文本文件", extensions: ["txt"] }],
    }))
  })

  it("broadcasts waiting/running states and returns the shared result", async () => {
    const result = { text: "正文", format: "pdf" as const, fileName: "report.pdf", size: 128, pages: 2 }
    const task = resolvedTask(result)
    const createTask = vi.fn(() => task)
    const windowManager = { broadcast: vi.fn() }
    const module = createTextExtractorIpcModule()

    await expect(module.methods.extractDocument.handler(createContext({
      "core.text-extractor": { createTask },
      "core.window-manager": windowManager,
    }), { operationId: "run-1", filePath })).resolves.toEqual({ ok: true, result })

    expect(createTask).toHaveBeenCalledWith(
      { filePath },
      { actor: { kind: "user", id: "synapse-renderer", display: "Synapse" } },
    )
    expect(windowManager.broadcast).toHaveBeenNthCalledWith(1,
      "synapse:app:text_extractor:operation:status",
      { operationId: "run-1", status: "waiting" },
    )
    expect(windowManager.broadcast).toHaveBeenNthCalledWith(2,
      "synapse:app:text_extractor:operation:status",
      { operationId: "run-1", status: "running" },
    )
  })

  it("cancels the active extraction and serializes stable errors", async () => {
    let rejectResult!: (error: unknown) => void
    const result = new Promise<never>((_resolve, reject) => { rejectResult = reject })
    const cancel = vi.fn(() => {
      rejectResult(new TextExtractionError("EXTRACTION_CANCELLED"))
      return true
    })
    const task = {
      result,
      getState: () => ({ id: "task-1", status: "waiting" as const }),
      subscribe: (listener: (state: { id: string; status: "waiting" }) => void) => {
        listener({ id: "task-1", status: "waiting" })
        return () => undefined
      },
      cancel,
    }
    const module = createTextExtractorIpcModule()
    const context = createContext({
      "core.text-extractor": { createTask: () => task },
      "core.window-manager": { broadcast: vi.fn() },
    })
    const extraction = module.methods.extractDocument.handler(context, { operationId: "run-1", filePath })

    await expect(module.methods.cancelExtraction.handler(context, { operationId: "run-1" }))
      .resolves.toEqual({ cancelled: true })
    await expect(extraction).resolves.toEqual({
      ok: false,
      error: {
        code: "EXTRACTION_CANCELLED",
        message: "文本提取已取消。",
      },
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("serializes synchronous extraction validation failures without exposing the path", async () => {
    const unsupportedPath = path.resolve("report.txt")
    const module = createTextExtractorIpcModule()

    const response = await module.methods.extractDocument.handler(createContext({
      "core.text-extractor": {
        createTask: () => { throw new TextExtractionError("UNSUPPORTED_FORMAT") },
      },
    }), { operationId: "run-1", filePath: unsupportedPath })

    expect(response).toEqual({
      ok: false,
      error: {
        code: "UNSUPPORTED_FORMAT",
        message: "当前仅支持 PDF 或 DOCX 文档。",
      },
    })
    expect(JSON.stringify(response)).not.toContain(unsupportedPath)
  })

  it("checks write permission, records a path-safe audit, and saves full UTF-8 text", async () => {
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true as const })) }
    const auditSink = { record: vi.fn() }
    const save = vi.fn(async () => ({ outputPath, fileName: "report.txt", size: 6 }))
    const module = createTextExtractorIpcModule({ saveService: { save } })

    await expect(module.methods.saveText.handler(createContext({
      "core.permission-guard": permissionGuard,
      "core.audit-sink": auditSink,
    }), { outputPath, text: "正文" })).resolves.toEqual({
      ok: true,
      result: {
        outputPath,
        fileName: "report.txt",
        size: 6,
      },
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: outputPath,
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      resource: "report.txt",
      outcome: "allowed",
    }))
    expect(save).toHaveBeenCalledWith({ outputPath, text: "正文" })
  })

  it("records denied write permission and does not save text", async () => {
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: false as const, reason: "denied", policyId: "test" })),
    }
    const auditSink = { record: vi.fn() }
    const save = vi.fn()
    const module = createTextExtractorIpcModule({ saveService: { save } })

    await expect(module.methods.saveText.handler(createContext({
      "core.permission-guard": permissionGuard,
      "core.audit-sink": auditSink,
    }), { outputPath, text: "正文" })).resolves.toEqual({
      ok: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "没有写入所选文件的权限。",
      },
    })

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      resource: "report.txt",
      outcome: "denied",
      metadata: expect.objectContaining({ policyId: "test" }),
    }))
    expect(auditSink.record.mock.calls[0]?.[0]?.metadata).not.toHaveProperty("reason")
    expect(save).not.toHaveBeenCalled()
  })

  it("serializes native save failures without exposing the output path", async () => {
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true as const })) }
    const auditSink = { record: vi.fn() }
    const nativeError = Object.assign(
      new Error(`ENOENT: no such file or directory, open '${outputPath}'`),
      { code: "ENOENT" },
    )
    const module = createTextExtractorIpcModule({
      saveService: { save: vi.fn(async () => { throw nativeError }) },
    })

    const response = await module.methods.saveText.handler(createContext({
      "core.permission-guard": permissionGuard,
      "core.audit-sink": auditSink,
    }), { outputPath, text: "正文" })

    expect(response).toEqual({
      ok: false,
      error: {
        code: "WRITE_FAILED",
        message: "保存文本失败。",
      },
    })
    expect(JSON.stringify(response)).not.toContain(outputPath)
  })

  it("cancels a queued or running extraction when its renderer is destroyed", async () => {
    let rejectResult!: (error: unknown) => void
    const result = new Promise<never>((_resolve, reject) => { rejectResult = reject })
    const cancel = vi.fn(() => {
      rejectResult(new TextExtractionError("EXTRACTION_CANCELLED"))
      return true
    })
    const task = {
      result,
      getState: () => ({ id: "task-1", status: "waiting" as const }),
      subscribe: (listener: (state: { id: string; status: "waiting" }) => void) => {
        listener({ id: "task-1", status: "waiting" })
        return () => undefined
      },
      cancel,
    }
    const sender = createSender(41)
    const module = createTextExtractorIpcModule()
    const extraction = module.methods.extractDocument.handler(createContext({
      "core.text-extractor": { createTask: () => task },
      "core.window-manager": { broadcast: vi.fn() },
    }, sender.context), { operationId: "run-lifetime", filePath })

    sender.destroy()

    await expect(extraction).resolves.toEqual({
      ok: false,
      error: {
        code: "EXTRACTION_CANCELLED",
        message: "文本提取已取消。",
      },
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("does not allow another renderer to cancel an owned extraction", async () => {
    let rejectResult!: (error: unknown) => void
    const result = new Promise<never>((_resolve, reject) => { rejectResult = reject })
    const cancel = vi.fn(() => {
      rejectResult(new TextExtractionError("EXTRACTION_CANCELLED"))
      return true
    })
    const task = {
      result,
      getState: () => ({ id: "task-1", status: "running" as const }),
      subscribe: () => () => undefined,
      cancel,
    }
    const owner = createSender(41)
    const other = createSender(42)
    const module = createTextExtractorIpcModule()
    const services = {
      "core.text-extractor": { createTask: () => task },
      "core.window-manager": { broadcast: vi.fn() },
    }
    const extraction = module.methods.extractDocument.handler(
      createContext(services, owner.context),
      { operationId: "run-owned", filePath },
    )

    await expect(module.methods.cancelExtraction.handler(
      createContext(services, other.context),
      { operationId: "run-owned" },
    )).resolves.toEqual({ cancelled: false })
    expect(cancel).not.toHaveBeenCalled()
    await expect(module.methods.cancelExtraction.handler(
      createContext(services, owner.context),
      { operationId: "run-owned" },
    )).resolves.toEqual({ cancelled: true })
    await extraction
  })
})

function createContext(
  services: Record<string, unknown> = {},
  invocation: Partial<IpcHandlerContext> = {},
): IpcHandlerContext {
  return {
    moduleId: "textExtractor",
    resolve: <T,>(serviceId: string): T => {
      if (!(serviceId in services)) throw new Error(`Unexpected service id: ${serviceId}`)
      return services[serviceId] as T
    },
    ...invocation,
  }
}

function createSender(id: number) {
  const destroyedListeners = new Set<() => void>()
  return {
    context: {
      sender: {
        id,
        isDestroyed: () => false,
        onDestroyed: (listener: () => void) => {
          destroyedListeners.add(listener)
          return () => destroyedListeners.delete(listener)
        },
      },
    },
    destroy: () => {
      for (const listener of destroyedListeners) listener()
    },
  }
}

function resolvedTask<Result>(result: Result) {
  return {
    result: Promise.resolve(result),
    getState: () => ({ id: "task-1", status: "waiting" as const }),
    subscribe: (listener: (state: { id: string; status: "waiting" | "running" }) => void) => {
      listener({ id: "task-1", status: "waiting" })
      listener({ id: "task-1", status: "running" })
      return () => undefined
    },
    cancel: vi.fn(() => true),
  }
}
