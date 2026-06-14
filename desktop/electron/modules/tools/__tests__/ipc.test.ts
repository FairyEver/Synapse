import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard, PermissionResult } from "../../../runtime/security"
import { toolsIpcModule } from "../ipc"

const electronMock = vi.hoisted(() => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}))

const logStoreMock = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  dialog: electronMock.dialog,
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

describe("toolsIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/report.docx"],
    })
  })

  it("lists atomic builtin tools", async () => {
    const { harness } = createHarness()

    const result = await harness.invoke("synapse:tools:list", {}) as { tools: Array<{ id: string }> }

    expect(result.tools.map((tool) => tool.id)).toEqual([
      "docx-to-markdown",
      "xlsx-to-markdown",
      "csv-to-markdown",
      "pdf-to-markdown",
      "pptx-to-markdown",
    ])
  })

  it("opens an atomic tool through the window service", async () => {
    const windowService = { open: vi.fn(async () => undefined) }
    const { harness } = createHarness({ windowService })

    await harness.invoke("synapse:tools:open", { toolId: "docx-to-markdown" })

    expect(windowService.open).toHaveBeenCalledWith("docx-to-markdown")
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("Tools IPC request.", expect.objectContaining({
      boundary: "tools.open",
      channel: "synapse:tools:open",
      toolId: "docx-to-markdown",
    }))
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("Tools IPC completed.", expect.objectContaining({
      boundary: "tools.open",
      channel: "synapse:tools:open",
      durationMs: expect.any(Number),
      toolId: "docx-to-markdown",
    }))
  })

  it("logs failed tool window opens without error text", async () => {
    const openError = new Error("open failed token=secret-token")
    const windowService = { open: vi.fn(async () => { throw openError }) }
    const { harness } = createHarness({ windowService })

    await expect(harness.invoke("synapse:tools:open", { toolId: "docx-to-markdown" }))
      .rejects.toThrow("open failed token=secret-token")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith("Tools IPC failed.", expect.objectContaining({
      boundary: "tools.open",
      channel: "synapse:tools:open",
      durationMs: expect.any(Number),
      errorLength: openError.message.length,
      errorName: "Error",
      toolId: "docx-to-markdown",
    }))
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("secret-token")
  })

  it("returns a renderer-safe descriptor", async () => {
    const { harness } = createHarness()

    const result = await harness.invoke("synapse:tools:descriptor", { toolId: "csv-to-markdown" }) as Record<string, unknown>

    expect(result.id).toBe("csv-to-markdown")
    expect(result.inputFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "inputPath", kind: "file" }),
      expect.objectContaining({ id: "delimiter", kind: "text" }),
    ]))
    expect("executor" in result).toBe(false)
  })

  it("selects a tool input file with descriptor extensions", async () => {
    const { harness } = createHarness()

    const result = await harness.invoke("synapse:tools:select-file", { toolId: "docx-to-markdown", fieldId: "inputPath" })

    expect(result).toEqual({ filePath: "/tmp/report.docx" })
    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openFile"],
      filters: [{ name: "支持的文件", extensions: ["docx"] }],
    }))
  })

  it("selects a tool output directory", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/tmp/out"],
    })
    const { harness } = createHarness()

    const result = await harness.invoke("synapse:tools:select-directory", { toolId: "docx-to-markdown", fieldId: "outputDirectory" })

    expect(result).toEqual({ directoryPath: "/tmp/out" })
    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith({
      properties: ["openDirectory"],
    })
  })

  it("uses the current directory as the output directory dialog default", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/tmp/out"],
    })
    const { harness } = createHarness()

    await harness.invoke("synapse:tools:select-directory", {
      toolId: "docx-to-markdown",
      fieldId: "outputDirectory",
      defaultPath: "/Users/test/Downloads",
    })

    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith({
      properties: ["openDirectory"],
      defaultPath: "/Users/test/Downloads",
    })
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("Tools IPC completed.", expect.objectContaining({
      boundary: "tools.select-directory",
      channel: "synapse:tools:select-directory",
      fieldId: "outputDirectory",
      hasDefaultPath: true,
      toolId: "docx-to-markdown",
    }))
    expect(JSON.stringify(logStoreMock.logger.info.mock.calls)).not.toContain("/Users/test/Downloads")
  })

  it("runs a builtin tool through the runner service", async () => {
    const runTool = vi.fn(async () => ({ ok: true, toolId: "docx-to-markdown", output: { markdown: "# OK" }, warnings: [], metadata: {} }))
    const { harness } = createHarness({ runTool })

    const result = await harness.invoke("synapse:tools:run", {
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
    })

    expect(result).toMatchObject({ ok: true, toolId: "docx-to-markdown" })
    expect(runTool).toHaveBeenCalledWith(expect.objectContaining({
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
      context: expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    }))
  })

  it("cancels an active builtin tool run by run id", async () => {
    const runTool = vi.fn(async (payload: unknown) => {
      const signal = (payload as { context: { abortSignal: AbortSignal } }).context.abortSignal
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
      return {
        ok: false,
        toolId: "docx-to-markdown",
        error: { code: "cancelled", message: "cancelled" },
        metadata: {},
      }
    })
    const { harness } = createHarness({ runTool })

    const runPromise = harness.invoke("synapse:tools:run", {
      toolId: "docx-to-markdown",
      input: { inputPath: "/tmp/a.docx", outputMode: "return" },
      runId: "run-1",
    })
    await waitForExpectation(() => {
      expect(runTool).toHaveBeenCalled()
    })

    await expect(harness.invoke("synapse:tools:cancel-run", { runId: "run-1" }))
      .resolves
      .toEqual({ cancelled: true })
    expect((runTool.mock.calls[0]?.[0] as { context: { abortSignal: AbortSignal } }).context.abortSignal.aborted)
      .toBe(true)
    await expect(runPromise).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    })
    await expect(harness.invoke("synapse:tools:cancel-run", { runId: "run-1" }))
      .resolves
      .toEqual({ cancelled: false })
  })
})

function createHarness(options: {
  readonly windowService?: { open(toolId: string): Promise<void> }
  readonly runTool?: (payload: unknown) => Promise<unknown>
} = {}) {
  const harness = createInMemoryHarness()
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => ({ allowed: true } satisfies PermissionResult)),
  }
  const auditSink: AuditSink = {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  const windowService = options.windowService ?? { open: vi.fn(async () => undefined) }
  const runTool = options.runTool ?? vi.fn(async () => ({ ok: true, toolId: "docx-to-markdown", output: {}, warnings: [], metadata: {} }))

  harness.registry.register(toolsIpcModule, {
    moduleId: "tools",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "tools.window-service") return windowService as T
      if (serviceId === "tools.builtin-tool-runner") return runTool as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
  })

  return { auditSink, harness, permissionGuard, runTool, windowService }
}

async function waitForExpectation(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw lastError
}
