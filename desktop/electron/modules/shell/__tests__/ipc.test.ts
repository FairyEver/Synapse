import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { shellIpcModule } from "../ipc"

const electronMock = vi.hoisted(() => ({
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  shell: electronMock.shell,
}))

describe("shellIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("opens http links through the system shell", async () => {
    const { harness, auditSink, permissionGuard } = createHarness()
    electronMock.shell.openExternal.mockResolvedValue(undefined)

    await harness.invoke("synapse:app:shell:external:open", {
      url: "https://example.com/path",
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "https://example.com/path",
      context: { source: "shell.openExternal" },
    })
    expect(electronMock.shell.openExternal).toHaveBeenCalledWith("https://example.com/path")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "https://example.com/path",
      outcome: "allowed",
      metadata: { source: "shell.openExternal" },
    }))
  })

  it("redacts external link credentials in PermissionGuard and audit records", async () => {
    const { harness, auditSink, permissionGuard } = createHarness()
    electronMock.shell.openExternal.mockResolvedValue(undefined)
    const rawUrl = "https://user:pass@example.com/path?token=secret-value&query=ok&code=oauth-code"
    const redactedUrl = "https://example.com/path?token=%5Bredacted%5D&query=ok&code=%5Bredacted%5D"

    await harness.invoke("synapse:app:shell:external:open", { url: rawUrl })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: redactedUrl,
      context: { source: "shell.openExternal" },
    })
    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(rawUrl)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      resource: redactedUrl,
      outcome: "allowed",
    }))
    expect(JSON.stringify(vi.mocked(permissionGuard.check).mock.calls)).not.toContain("secret-value")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("oauth-code")
  })

  it("rejects non-web external links", async () => {
    const { harness, permissionGuard, auditSink } = createHarness()

    await expect(harness.invoke("synapse:app:shell:external:open", {
      url: "file:///Users/test/secret.txt",
    })).rejects.toThrow()

    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
    expect(auditSink.record).not.toHaveBeenCalled()
  })

  it("denies external links before calling the system shell", async () => {
    const { harness, auditSink } = createHarness({
      permission: { allowed: false, reason: "denied by test-policy", policyId: "test-policy" },
    })

    await expect(harness.invoke("synapse:app:shell:external:open", {
      url: "https://example.com/path",
    })).rejects.toThrow("denied by test-policy")

    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "https://example.com/path",
      outcome: "denied",
      metadata: {
        source: "shell.openExternal",
        reason: "denied by test-policy",
        policyId: "test-policy",
      },
    }))
  })

  it("shows items in Finder through PermissionGuard and AuditSink", async () => {
    const { harness, auditSink, permissionGuard } = createHarness()

    await harness.invoke("synapse:app:shell:item:show_in_folder", {
      fullPath: "/Users/test/project/file.md",
    })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "/Users/test/project/file.md",
      context: { source: "shell.showItemInFolder" },
    })
    expect(electronMock.shell.showItemInFolder).toHaveBeenCalledWith("/Users/test/project/file.md")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "/Users/test/project/file.md",
      outcome: "allowed",
      metadata: { source: "shell.showItemInFolder" },
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
  harness.registry.register(shellIpcModule, {
    moduleId: "shell",
    resolve: <T,>(serviceId: string): T => {
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
  })
  return { harness, auditSink, permissionGuard }
}
