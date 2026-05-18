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

vi.mock("electron", () => ({
  shell: electronMock.shell,
}))

vi.mock("node:fs/promises", () => ({
  mkdir: fsMock.mkdir,
}))

describe("editorIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMock.mkdir.mockResolvedValue(undefined)
  })

  it("creates directories and shows them through PermissionGuard and AuditSink", async () => {
    const { harness, auditSink, permissionGuard } = createHarness()

    await harness.invoke("synapse:editor:create-directory", {
      dirPath: "/Users/test/.claude/rules",
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/Users/test/.claude/rules",
      context: { source: "editor.createDirectory" },
    })
    expect(fsMock.mkdir).toHaveBeenCalledWith("/Users/test/.claude/rules", { recursive: true })
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "/Users/test/.claude/rules",
      context: { source: "editor.createDirectory" },
    })
    expect(electronMock.shell.showItemInFolder).toHaveBeenCalledWith("/Users/test/.claude/rules")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/Users/test/.claude/rules",
      outcome: "allowed",
      metadata: { source: "editor.createDirectory" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "/Users/test/.claude/rules",
      outcome: "allowed",
      metadata: { source: "editor.createDirectory" },
    }))
  })

  it("does not create directories when fs.write permission is denied", async () => {
    const { harness, auditSink } = createHarness({
      permission: { allowed: false, reason: "denied by test-policy", policyId: "test-policy" },
    })

    await expect(harness.invoke("synapse:editor:create-directory", {
      dirPath: "/Users/test/.claude/skills",
    })).rejects.toThrow("denied by test-policy")

    expect(fsMock.mkdir).not.toHaveBeenCalled()
    expect(electronMock.shell.showItemInFolder).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/Users/test/.claude/skills",
      outcome: "denied",
      metadata: {
        source: "editor.createDirectory",
        reason: "denied by test-policy",
        policyId: "test-policy",
      },
    }))
  })
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
