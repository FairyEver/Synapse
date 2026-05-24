import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { knowledgeBaseIpcModule } from "../ipc"

const electronMock = vi.hoisted(() => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
}))

const sourceManagerWindowServiceMock = vi.hoisted(() => ({
  open: vi.fn(),
}))

vi.mock("electron", () => ({
  dialog: electronMock.dialog,
  shell: electronMock.shell,
}))

vi.mock("../../../services/knowledge-base/source-manager-window-service", () => ({
  knowledgeBaseSourceManagerWindowService: sourceManagerWindowServiceMock,
}))

describe("knowledgeBaseIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.shell.openPath.mockResolvedValue("")
    electronMock.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/tmp/source.md"] })
    sourceManagerWindowServiceMock.open.mockResolvedValue(undefined)
  })

  it("inspects a knowledge base through guarded read permission", async () => {
    const inspect = vi.fn().mockResolvedValue({
      projectPath: "/tmp/kb",
      isKnowledgeBase: true,
      hasMetadata: true,
      hasRequiredShape: true,
      missingRequiredPaths: [],
      templateVersion: "2026-05-21",
    })
    const { auditSink, harness, permissionGuard } = createHarness({ service: { inspect } })

    const result = await harness.invoke("synapse:knowledge-base:inspect", {
      projectPath: "/tmp/kb",
    }) as { isKnowledgeBase: boolean }

    expect(inspect).toHaveBeenCalledWith("/tmp/kb")
    expect(result.isKnowledgeBase).toBe(true)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/kb",
      context: { source: "knowledgeBase.inspect" },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/kb",
      outcome: "allowed",
      metadata: { source: "knowledgeBase.inspect" },
    }))
  })

  it("initializes a knowledge base through the service", async () => {
    const initialize = vi.fn().mockResolvedValue({
      projectPath: "/tmp/kb",
      templateVersion: "2026-05-21",
      createdFiles: [".synapse-kb.json"],
      existingFiles: [],
    })
    const { harness } = createHarness({ service: { initialize } })

    const result = await harness.invoke("synapse:knowledge-base:initialize", {
      projectPath: "/tmp/kb",
      mode: "create",
    }) as { createdFiles: string[] }

    expect(initialize).toHaveBeenCalledWith({ projectPath: "/tmp/kb", mode: "create" })
    expect(result.createdFiles).toEqual([".synapse-kb.json"])
  })

  it("lists source files through guarded read permission", async () => {
    const listSources = vi.fn().mockResolvedValue({
      projectPath: "/tmp/kb",
      sources: [{
        relativePath: "2026/05/23/source.md",
        name: "source.md",
        size: 12,
        modifiedAt: "2026-05-23T00:00:00.000Z",
        supported: true,
        status: "pending",
        hash: "abc",
      }],
    })
    const { harness, permissionGuard } = createHarness({ service: { listSources } })

    const result = await harness.invoke("synapse:knowledge-base:list-sources", {
      projectPath: "/tmp/kb",
    }) as { sources: unknown[] }

    expect(listSources).toHaveBeenCalledWith("/tmp/kb")
    expect(result.sources).toHaveLength(1)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/kb",
      context: { source: "knowledgeBase.listSources" },
    })
  })

  it("uploads selected source files through guarded write permission", async () => {
    const uploadSources = vi.fn().mockResolvedValue({
      projectPath: "/tmp/kb",
      uploaded: [{
        originalPath: "/tmp/source.md",
        relativePath: "2026/05/23/source.md",
        originalRelativePath: "_attachments/originals/2026/05/23/source.docx",
        name: "source.md",
        size: 12,
        conversionWarnings: [{ code: "presentation_structure_limited", message: "Limited structure" }],
      }],
      skipped: [{ path: "/tmp/broken.docx", reason: "conversion-error" }],
    })
    const { harness, permissionGuard } = createHarness({ service: { uploadSources } })

    const result = await harness.invoke("synapse:knowledge-base:select-and-upload-sources", {
      projectPath: "/tmp/kb",
    }) as { uploaded: unknown[] }

    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openFile", "multiSelections"],
    }))
    expect(uploadSources).toHaveBeenCalledWith({
      projectPath: "/tmp/kb",
      filePaths: ["/tmp/source.md"],
    })
    expect(result.uploaded).toHaveLength(1)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/kb",
      context: { source: "knowledgeBase.selectAndUploadSources" },
    })
  })

  it("uploads dropped source files through guarded write permission", async () => {
    const uploadSources = vi.fn().mockResolvedValue({
      projectPath: "/tmp/kb",
      uploaded: [],
      skipped: [],
    })
    const { harness } = createHarness({ service: { uploadSources } })

    await harness.invoke("synapse:knowledge-base:upload-sources", {
      projectPath: "/tmp/kb",
      filePaths: ["/tmp/source.md"],
    })

    expect(uploadSources).toHaveBeenCalledWith({
      projectPath: "/tmp/kb",
      filePaths: ["/tmp/source.md"],
    })
  })

  it("opens the source manager window through guarded read permission", async () => {
    const { harness, permissionGuard } = createHarness({ service: {} })

    await harness.invoke("synapse:knowledge-base:open-source-manager", {
      projectId: "project-1",
      projectPath: "/tmp/kb",
      projectName: "知识库001",
    })

    expect(sourceManagerWindowServiceMock.open).toHaveBeenCalledWith({
      projectId: "project-1",
      projectPath: "/tmp/kb",
      projectName: "知识库001",
    })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/kb",
      context: { source: "knowledgeBase.openSourceManager" },
    })
  })

  it("opens raw directory through guarded write and shell permissions", async () => {
    const openRawDirectory = vi.fn().mockResolvedValue({ rawPath: "/tmp/kb/.raw" })
    const { auditSink, harness, permissionGuard } = createHarness({ service: { openRawDirectory } })

    const result = await harness.invoke("synapse:knowledge-base:open-raw-directory", {
      projectPath: "/tmp/kb",
    }) as { rawPath: string }

    expect(openRawDirectory).toHaveBeenCalledWith("/tmp/kb")
    expect(result.rawPath).toBe("/tmp/kb/.raw")
    expect(permissionGuard.check).toHaveBeenNthCalledWith(1, {
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/kb",
      context: { source: "knowledgeBase.ensureRawDirectory" },
    })
    expect(permissionGuard.check).toHaveBeenNthCalledWith(2, {
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "/tmp/kb/.raw",
      context: { source: "knowledgeBase.openRawDirectory" },
    })
    expect(electronMock.shell.openPath).toHaveBeenCalledWith("/tmp/kb/.raw")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/kb",
      outcome: "allowed",
      metadata: { source: "knowledgeBase.ensureRawDirectory" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "/tmp/kb/.raw",
      outcome: "allowed",
      metadata: { source: "knowledgeBase.openRawDirectory" },
    }))
  })

  it("does not open raw directory when shell permission is denied", async () => {
    const openRawDirectory = vi.fn().mockResolvedValue({ rawPath: "/tmp/kb/.raw" })
    const { auditSink, harness, permissionGuard } = createHarness({
      permissions: [
        { allowed: true },
        { allowed: false, reason: "denied by shell policy", policyId: "shell-policy" },
      ],
      service: { openRawDirectory },
    })

    await expect(harness.invoke("synapse:knowledge-base:open-raw-directory", {
      projectPath: "/tmp/kb",
    })).rejects.toThrow("denied by shell policy")

    expect(openRawDirectory).toHaveBeenCalledWith("/tmp/kb")
    expect(permissionGuard.check).toHaveBeenCalledTimes(2)
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "/tmp/kb/.raw",
      outcome: "denied",
      metadata: {
        source: "knowledgeBase.openRawDirectory",
        reason: "denied by shell policy",
        policyId: "shell-policy",
      },
    }))
  })

  it("records shell failures when opening raw directory fails", async () => {
    const openRawDirectory = vi.fn().mockResolvedValue({ rawPath: "/tmp/kb/.raw" })
    const { auditSink, harness } = createHarness({ service: { openRawDirectory } })
    electronMock.shell.openPath.mockResolvedValue("open failed")

    await expect(harness.invoke("synapse:knowledge-base:open-raw-directory", {
      projectPath: "/tmp/kb",
    })).rejects.toThrow("open failed")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "/tmp/kb/.raw",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "knowledgeBase.openRawDirectory",
        errorName: "Error",
      }),
    }))
  })
})

function createHarness(options: {
  permissions?: Awaited<ReturnType<PermissionGuard["check"]>>[]
  service: unknown
}) {
  const harness = createInMemoryHarness()
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(),
  }
  for (const permission of options.permissions ?? [{ allowed: true }]) {
    vi.mocked(permissionGuard.check).mockResolvedValueOnce(permission)
  }
  vi.mocked(permissionGuard.check).mockResolvedValue({ allowed: true })
  const auditSink: AuditSink = {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  harness.registry.register(knowledgeBaseIpcModule, {
    moduleId: "knowledge-base",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "knowledge-base.service") return options.service as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
  })
  return { auditSink, harness, permissionGuard }
}
