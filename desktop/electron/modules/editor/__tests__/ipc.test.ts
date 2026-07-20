import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { editorIpcModule } from "../ipc"

const electronMock = vi.hoisted(() => ({
  shell: {
    showItemInFolder: vi.fn(),
  },
}))

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
}))

const editorAdapterServiceMock = vi.hoisted(() => ({
  getGlobalDirectories: vi.fn(),
}))

vi.mock("electron", () => ({
  shell: electronMock.shell,
}))

vi.mock("node:fs/promises", () => ({
  mkdir: fsMock.mkdir,
}))

vi.mock("../../../services/editor-adapter-service", () => ({
  editorAdapterService: editorAdapterServiceMock,
}))

describe("editorIpcModule", () => {
  const rulesPath = path.resolve("/Users/test/.claude/rules")
  const skillsPath = path.resolve("/Users/test/.claude/skills")

  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.mkdir.mockResolvedValue(undefined)
    editorAdapterServiceMock.getGlobalDirectories.mockResolvedValue([
      {
        editorId: "codex",
        label: "Codex",
        rulesPath,
        rulesExists: false,
        skillsPath,
        skillsExists: false,
      },
    ])
  })

  it("creates directories and shows them through PermissionGuard and AuditSink", async () => {
    const { harness, auditSink, permissionGuard } = createHarness()

    await harness.invoke("synapse:app:editor:operation:create_directory", {
      dirPath: rulesPath,
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: rulesPath,
      context: { source: "editor.createDirectory" },
    })
    expect(fsMock.mkdir).toHaveBeenCalledWith(rulesPath, { recursive: true })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: rulesPath,
      context: { source: "editor.createDirectory" },
    })
    expect(electronMock.shell.showItemInFolder).toHaveBeenCalledWith(rulesPath)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: rulesPath,
      outcome: "allowed",
      metadata: { source: "editor.createDirectory" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: rulesPath,
      outcome: "allowed",
      metadata: { source: "editor.createDirectory" },
    }))
  })

  it("creates the parent directory when a global rules path points to a file", async () => {
    const rulesFilePath = path.resolve("/Users/test/.gemini/GEMINI.md")
    const rulesParentPath = path.dirname(rulesFilePath)
    editorAdapterServiceMock.getGlobalDirectories.mockResolvedValue([
      {
        editorId: "antigravity",
        label: "Antigravity",
        rulesPath: rulesFilePath,
        rulesPathKind: "file",
        rulesExists: false,
        skillsPath,
        skillsPathKind: "directory",
        skillsExists: false,
      },
    ])
    const { harness, auditSink, permissionGuard } = createHarness()

    await harness.invoke("synapse:app:editor:operation:create_directory", {
      dirPath: rulesFilePath,
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: rulesParentPath,
      context: {
        source: "editor.createDirectory",
        requestedPath: rulesFilePath,
        pathKind: "file",
      },
    })
    expect(fsMock.mkdir).toHaveBeenCalledWith(rulesParentPath, { recursive: true })
    expect(electronMock.shell.showItemInFolder).toHaveBeenCalledWith(rulesParentPath)
    expect(fsMock.mkdir).not.toHaveBeenCalledWith(rulesFilePath, expect.anything())
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: rulesParentPath,
      outcome: "allowed",
      metadata: {
        source: "editor.createDirectory",
        requestedPath: rulesFilePath,
        pathKind: "file",
      },
    }))
  })

  it("rejects directory creation outside known global editor directories", async () => {
    const { harness, permissionGuard, auditSink } = createHarness()

    await expect(harness.invoke("synapse:app:editor:operation:create_directory", {
      dirPath: "/Users/test/Documents/unexpected",
    })).rejects.toThrow("只能创建已知编辑器目录。")

    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(fsMock.mkdir).not.toHaveBeenCalled()
    expect(electronMock.shell.showItemInFolder).not.toHaveBeenCalled()
    expect(auditSink.record).not.toHaveBeenCalled()
  })

  it("does not create directories when fs.write permission is denied", async () => {
    const { harness, auditSink } = createHarness({
      permission: { allowed: false, reason: "denied by test-policy", policyId: "test-policy" },
    })

    await expect(harness.invoke("synapse:app:editor:operation:create_directory", {
      dirPath: skillsPath,
    })).rejects.toThrow("denied by test-policy")

    expect(fsMock.mkdir).not.toHaveBeenCalled()
    expect(electronMock.shell.showItemInFolder).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: skillsPath,
      outcome: "denied",
      metadata: {
        source: "editor.createDirectory",
        reason: "denied by test-policy",
        policyId: "test-policy",
      },
    }))
  })
})

function createHarness(options: {
  permission?: Awaited<ReturnType<PermissionGuard["check"]>>
} = {}) {
  const harness = createInMemoryHarness()
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn().mockResolvedValue(options.permission ?? { allowed: true }),
  }
  const auditSink: AuditSink = {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
  harness.registry.register(editorIpcModule, {
    moduleId: "editor",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
  })
  return { harness, auditSink, permissionGuard }
}
