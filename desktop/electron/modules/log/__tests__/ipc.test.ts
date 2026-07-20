import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { logIpcModule } from "../ipc"

const mocks = vi.hoisted(() => ({
  dialog: {
    showSaveDialog: vi.fn(),
  },
  logStore: {
    clearAllLogs: vi.fn(),
    exportAllLogs: vi.fn(),
    getLogDirectory: vi.fn(() => "/logs"),
    listLogFilesInfo: vi.fn(),
    readAllLogs: vi.fn(),
    readLogsByNames: vi.fn(),
    write: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/downloads"),
  },
  dialog: mocks.dialog,
}))

vi.mock("../../../services/log-store", () => ({
  logStore: mocks.logStore,
}))

describe("logIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.logStore.getLogDirectory.mockReturnValue("/logs")
    mocks.logStore.clearAllLogs.mockResolvedValue({ fileCount: 2 })
    mocks.logStore.readAllLogs.mockResolvedValue("all logs")
    mocks.logStore.readLogsByNames.mockResolvedValue("selected logs")
  })

  it("requires permission and records audit before clearing logs", async () => {
    const { auditSink, harness, permissionGuard } = createHarness()

    await expect(harness.invoke("synapse:app:log:entry:clear", undefined)).resolves.toEqual({ fileCount: 2 })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/logs",
      context: { source: "log.clear" },
    })
    expect(mocks.logStore.clearAllLogs).toHaveBeenCalledTimes(1)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "/logs",
      metadata: { source: "log.clear" },
    }))
  })

  it("does not clear logs when permission is denied", async () => {
    const { auditSink, harness, permissionGuard } = createHarness({
      permission: { allowed: false, reason: "denied by test-policy", policyId: "test-policy" },
    })

    await expect(harness.invoke("synapse:app:log:entry:clear", undefined)).rejects.toThrow("denied by test-policy")

    expect(mocks.logStore.clearAllLogs).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: "/logs",
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "denied",
      resource: "/logs",
      metadata: {
        policyId: "test-policy",
        reason: "denied by test-policy",
        source: "log.clear",
      },
    }))
  })

  it("requires permission and records audit before reading all logs", async () => {
    const { auditSink, harness, permissionGuard } = createHarness()

    await expect(harness.invoke("synapse:app:log:operation:read_all", undefined)).resolves.toBe("all logs")

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/logs",
      context: { source: "log.readAll" },
    })
    expect(mocks.logStore.readAllLogs).toHaveBeenCalledTimes(1)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
      resource: "/logs",
      metadata: { source: "log.readAll" },
    }))
  })

  it("does not read selected log files when permission is denied", async () => {
    const { auditSink, harness } = createHarness({
      permission: { allowed: false, reason: "denied by test-policy", policyId: "test-policy" },
    })

    await expect(harness.invoke("synapse:app:log:operation:read_files", ["main.log"])).rejects.toThrow("denied by test-policy")

    expect(mocks.logStore.readLogsByNames).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "denied",
      resource: "/logs",
      metadata: {
        fileCount: 1,
        policyId: "test-policy",
        reason: "denied by test-policy",
        source: "log.readFiles",
      },
    }))
  })
})

function createHarness(options: {
  permission?: Awaited<ReturnType<PermissionGuard["check"]>>
} = {}) {
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => options.permission ?? { allowed: true as const }),
  }
  const auditSink: AuditSink = {
    clearForTests: vi.fn(),
    list: vi.fn(() => []),
    record: vi.fn(),
  }
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    if (serviceId === "core.permission-guard") return permissionGuard as T
    if (serviceId === "core.audit-sink") return auditSink as T
    throw new Error(`Unknown service: ${serviceId}`)
  }
  harness.registry.register(logIpcModule, { moduleId: "log", resolve })
  return { auditSink, harness, permissionGuard }
}
