import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { knowledgeBaseIpcModule } from "../ipc"

const electronMock = vi.hoisted(() => ({
  shell: {
    openPath: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  shell: electronMock.shell,
}))

describe("knowledgeBaseIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.shell.openPath.mockResolvedValue("")
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
