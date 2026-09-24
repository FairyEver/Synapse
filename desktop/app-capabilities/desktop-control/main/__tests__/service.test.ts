import { describe, expect, it, vi } from "vitest"
import type { SynapseAppUpdateState } from "../../../../src/types/update"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
import { DesktopControlService } from "../service"

const context = { source: "mcp-http" as const }

function state(status: SynapseAppUpdateState["status"]): SynapseAppUpdateState {
  return {
    currentVersion: "1.0.0",
    releaseVersion: status === "available" || status === "downloaded" ? "1.1.0" : null,
    status,
    message: status,
    error: status === "error" ? "更新失败" : null,
    downloadPercent: null,
    bytesPerSecond: null,
    transferredBytes: null,
    totalBytes: null,
    lastCheckedAt: null,
    canCheck: true,
    installRecovery: null,
  }
}

function harness(initial: SynapseAppUpdateState["status"] = "idle", allowed = true, ready = true) {
  let current = state(initial)
  const listeners = new Set<(value: SynapseAppUpdateState) => void>()
  const scheduled: Array<() => void> = []
  const update = {
    getState: vi.fn(() => current),
    checkForUpdates: vi.fn(async () => current),
    downloadUpdate: vi.fn(async () => current),
    installUpdate: vi.fn(async () => {}),
    subscribeState: vi.fn((listener: (value: SynapseAppUpdateState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  const auditSink = new InMemoryAuditSink()
  const service = new DesktopControlService({
    update,
    permissionGuard: { check: vi.fn(async () => allowed ? { allowed: true as const } : { allowed: false as const, reason: "denied" }), registerPolicy: vi.fn() },
    auditSink,
    logger: { error: vi.fn(), info: vi.fn() },
    isUpdateReady: () => ready,
    schedule: (callback) => { scheduled.push(callback) },
  })
  return {
    service,
    update,
    auditSink,
    scheduled,
    setStatus(status: SynapseAppUpdateState["status"]) {
      current = state(status)
      for (const listener of listeners) listener(current)
    },
  }
}

describe("DesktopControlService", () => {
  it("returns process identity and checks without scheduling an exit", async () => {
    const h = harness()
    const before = h.service.getState()
    expect(before.bootId).toBeTruthy()
    expect(before.startedAt).toBeTruthy()
    expect(before.remoteOperation).toBeNull()
    await h.service.check(context)
    expect(h.update.checkForUpdates).toHaveBeenCalledWith({ refreshAvailable: true })
    expect(h.scheduled).toHaveLength(0)
    expect(new DesktopControlService({
      update: h.update,
      permissionGuard: { check: async () => ({ allowed: true }), registerPolicy: vi.fn() },
      auditSink: h.auditSink,
      logger: { error: vi.fn(), info: vi.fn() },
    }).getState().bootId).toBe(before.bootId)
  })

  it("completes without restart when no update is available", async () => {
    const h = harness()
    h.update.checkForUpdates.mockImplementation(async () => {
      h.setStatus("not-available")
      return h.update.getState()
    })
    const accepted = await h.service.runUpdate(context)
    expect(accepted.accepted).toBe(true)
    h.scheduled[0]()
    await vi.waitFor(() => expect(h.service.getState().remoteOperation?.phase).toBe("completed"))
    expect(h.update.downloadUpdate).not.toHaveBeenCalled()
    expect(h.update.installUpdate).not.toHaveBeenCalled()
  })

  it("downloads, installs, and coalesces duplicate update requests", async () => {
    const h = harness("available")
    h.update.downloadUpdate.mockImplementation(async () => {
      h.setStatus("downloading")
      return h.update.getState()
    })
    const first = await h.service.runUpdate(context)
    const repeated = await h.service.runUpdate(context)
    expect(repeated.operationId).toBe(first.operationId)
    expect(h.scheduled).toHaveLength(1)
    h.scheduled[0]()
    await vi.waitFor(() => expect(h.service.getState().remoteOperation?.phase).toBe("downloading"))
    h.setStatus("downloaded")
    await vi.waitFor(() => expect(h.update.installUpdate).toHaveBeenCalledTimes(1))
    expect(h.service.getState().remoteOperation?.phase).toBe("installing")
  })

  it("installs an already downloaded update", async () => {
    const h = harness("downloaded")
    await h.service.runUpdate(context)
    h.scheduled[0]()
    await vi.waitFor(() => expect(h.update.installUpdate).toHaveBeenCalledTimes(1))
    expect(h.update.checkForUpdates).not.toHaveBeenCalled()
    expect(h.update.downloadUpdate).not.toHaveBeenCalled()
  })

  it("keeps the process running and exposes install handoff failure", async () => {
    const h = harness("downloaded")
    h.update.installUpdate.mockRejectedValue(new Error("ShipIt 未启动"))
    await h.service.runUpdate(context)
    h.scheduled[0]()
    await vi.waitFor(() => expect(h.service.getState().remoteOperation?.phase).toBe("failed"))
    expect(h.service.getState().remoteOperation?.error).toContain("ShipIt 未启动")
  })

  it("fully restarts once and rejects a concurrent update", async () => {
    const h = harness()
    const restart = vi.fn()
    h.service.setRestartHandler(restart)
    const first = await h.service.restartDesktop(context)
    expect((await h.service.restartDesktop(context)).operationId).toBe(first.operationId)
    await expect(h.service.runUpdate(context)).rejects.toThrow("另一项")
    h.scheduled[0]()
    expect(restart).toHaveBeenCalledTimes(1)
    expect(h.service.getState().remoteOperation?.phase).toBe("restarting")
  })

  it("rejects unsupported updates and denied restarts", async () => {
    const unsupported = harness("unsupported")
    await expect(unsupported.service.runUpdate(context)).rejects.toThrow("unsupported")
    const denied = harness("idle", false)
    await expect(denied.service.restartDesktop(context)).rejects.toThrow("权限")
    expect(denied.auditSink.list()).toEqual([expect.objectContaining({ outcome: "denied" })])
  })

  it("does not start an update before the native updater is configured", async () => {
    const h = harness("idle", true, false)
    await expect(h.service.runUpdate(context)).rejects.toThrow("尚未就绪")
    expect(h.scheduled).toHaveLength(0)
  })
})
