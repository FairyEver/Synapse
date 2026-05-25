import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard, PermissionResult } from "../../../runtime/security"
import { toolsIpcModule } from "../ipc"

const electronMock = vi.hoisted(() => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  dialog: electronMock.dialog,
}))

describe("toolsIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/report.docx"],
    })
  })

  it("lists registered tools", async () => {
    const { harness } = createHarness()

    const result = await harness.invoke("synapse:tools:list", {}) as { tools: Array<{ id: string }> }

    expect(result.tools).toEqual([expect.objectContaining({ id: "file-conversion" })])
  })

  it("opens a tool through the generic window service", async () => {
    const windowService = { open: vi.fn(async () => undefined) }
    const { harness } = createHarness({ windowService })

    await harness.invoke("synapse:tools:open", { toolId: "file-conversion" })

    expect(windowService.open).toHaveBeenCalledWith("file-conversion")
  })

  it("selects supported file conversion inputs", async () => {
    const { harness } = createHarness()

    const result = await harness.invoke("synapse:tools:file-conversion:select-input-files", {})

    expect(result).toEqual({ filePaths: ["/tmp/report.docx"] })
    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "支持的文档", extensions: ["docx", "xlsx", "pdf", "pptx"] }],
    }))
  })

  it("selects a file conversion output directory", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ["/tmp/out"],
    })
    const { harness } = createHarness()

    const result = await harness.invoke("synapse:tools:file-conversion:select-output-directory", {})

    expect(result).toEqual({ directoryPath: "/tmp/out" })
  })

  it("runs conversion through guarded read and write permissions", async () => {
    const runConversion = vi.fn(async () => ({ successes: [], failures: [] }))
    const { harness, permissionGuard } = createHarness({ runConversion })

    await harness.invoke("synapse:tools:file-conversion:convert", {
      filePaths: ["/tmp/report.docx"],
      outputDirectory: "/tmp/out",
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/report.docx",
      context: { source: "tools.fileConversion.convert.read" },
    })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/out",
      context: { source: "tools.fileConversion.convert.write" },
    })
    expect(runConversion).toHaveBeenCalledWith({
      filePaths: ["/tmp/report.docx"],
      outputDirectory: "/tmp/out",
    })
  })
})

function createHarness(options: {
  readonly windowService?: { open(toolId: string): Promise<void> }
  readonly runConversion?: (payload: { readonly filePaths: readonly string[]; readonly outputDirectory: string }) => Promise<unknown>
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
  const runConversion = options.runConversion ?? vi.fn(async () => ({ successes: [], failures: [] }))

  harness.registry.register(toolsIpcModule, {
    moduleId: "tools",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "tools.window-service") return windowService as T
      if (serviceId === "tools.file-conversion-runner") return runConversion as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
  })

  return { auditSink, harness, permissionGuard, runConversion, windowService }
}
