import { describe, expect, it, vi } from "vitest"
import {
  skillUninstallQuerySchema,
  skillUninstallTargetSchema,
} from "../../shared/schema"

const notifyInstallStatusChanged = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock("../../../../electron/modules/install-status-events", () => ({
  notifyInstallStatusChanged,
}))

vi.mock("../../../../electron/services/log-store", () => ({
  createMainLogger: () => ({ warn: vi.fn() }),
}))

describe("skill uninstaller schemas", () => {
  it("accepts a name with an optional search root", () => {
    expect(skillUninstallQuerySchema.parse({ name: "jenkins" })).toEqual({ name: "jenkins" })
    expect(skillUninstallQuerySchema.parse({
      name: "jenkins",
      searchRootPath: "/repo",
    })).toEqual({ name: "jenkins", searchRootPath: "/repo" })
  })

  it("rejects empty names and empty target paths", () => {
    expect(() => skillUninstallQuerySchema.parse({ name: "  " })).toThrow()
    expect(() => skillUninstallTargetSchema.parse({
      query: { name: "jenkins" },
      path: "",
    })).toThrow()
  })

  it("registers scan, cancel, and uninstall channels", async () => {
    const { skillUninstallerIpcModule } = await import("../ipc")
    expect(Object.keys(skillUninstallerIpcModule.methods)).toEqual(["scan", "cancelScan", "uninstall"])
  })

  it("removes a scan controller immediately after cancellation", async () => {
    const { createSkillUninstallerIpcModule } = await import("../ipc")
    let scanSignal: AbortSignal | undefined
    const scan = vi.fn((_query, _security, signal: AbortSignal) => {
      scanSignal = signal
      return new Promise(() => undefined)
    })
    const module = createSkillUninstallerIpcModule({ scan, uninstall: vi.fn() } as never)
    const ctx = {
      resolve: vi.fn(() => ({})),
    }
    void module.methods.scan.handler(ctx as never, {
      scanId: "scan-1",
      query: { name: "jenkins" },
    })
    await expect(module.methods.cancelScan.handler(ctx as never, { scanId: "scan-1" }))
      .resolves.toEqual({ cancelled: true })
    expect(scanSignal?.aborted).toBe(true)
    await expect(module.methods.cancelScan.handler(ctx as never, { scanId: "scan-1" }))
      .resolves.toEqual({ cancelled: false })
  })

  it("refreshes install status after uninstalling Synapse-owned content", async () => {
    const { createSkillUninstallerIpcModule } = await import("../ipc")
    const eventBus = {}
    const uninstall = vi.fn(async (_targets, _security, hooks) => {
      await hooks.onTrashedContentId("content-1")
      return { results: [{ path: "/tmp/jenkins", status: "trashed" as const }] }
    })
    const module = createSkillUninstallerIpcModule({ scan: vi.fn(), uninstall } as never)
    const ctx = {
      resolve: vi.fn((id: string) => id === "core.event-bus" ? eventBus : {}),
    }

    await module.methods.uninstall.handler(ctx as never, {
      targets: [{ query: { name: "jenkins" }, path: "/tmp/jenkins" }],
    })

    expect(notifyInstallStatusChanged).toHaveBeenCalledWith(
      eventBus,
      "content-1",
      expect.objectContaining({
        warningMessage: "Failed to refresh install status after Skill uninstall.",
      }),
    )
  })
})
