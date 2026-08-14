import { describe, expect, it, vi } from "vitest"

import type { DataNamespace } from "../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { ControlledProcessRunner } from "../../runtime/process"
import type { UpdateInstallRecoveryEntryV1 } from "../../runtime/data-repo/schemas/update-install-recovery"
import { UpdateInstallRecoveryService } from "../update-install-recovery-service"

const DMG_URL = "https://desktop.release.synapse.d2.pub/v0.2.32/Synapse-0.2.32-mac-arm64.dmg"

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => loggerMock,
}))

function createFixture(initial: UpdateInstallRecoveryEntryV1["pendingAttempt"] = null) {
  let entry: UpdateInstallRecoveryEntryV1 = {
    schemaVersion: 1,
    pendingAttempt: initial,
  }
  const stateStore = {
    getSingleton: vi.fn(async () => structuredClone(entry)),
    setSingleton: vi.fn(async (value: UpdateInstallRecoveryEntryV1) => {
      entry = structuredClone(value)
    }),
  } as unknown as DataNamespace<UpdateInstallRecoveryEntryV1>
  const checkPermission = vi.fn<PermissionGuard["check"]>()
  checkPermission.mockResolvedValue({ allowed: true })
  const permissionGuard = {
    check: checkPermission,
    registerPolicy: vi.fn(),
  } satisfies PermissionGuard
  const auditSink = {
    clearForTests: vi.fn(),
    list: vi.fn(() => []),
    record: vi.fn(),
  } satisfies AuditSink
  const runProcess = vi.fn<ControlledProcessRunner["run"]>()
  runProcess.mockResolvedValue({
    durationMs: 1,
    exitCode: 0,
    signal: null,
    stdout: "",
    timedOut: false,
  })
  const processRunner = {
    run: runProcess,
  } as unknown as ControlledProcessRunner
  const removePath = vi.fn<(targetPath: string) => Promise<void>>(async () => undefined)
  const service = new UpdateInstallRecoveryService({
    auditSink,
    cacheDirectory: "/Users/test/Library/Caches",
    getUid: () => 501,
    permissionGuard,
    processRunner,
    removePath,
    stateStore,
  })

  return {
    auditSink,
    current: () => structuredClone(entry),
    permissionGuard,
    processRunner,
    runProcess,
    removePath,
    service,
    stateStore,
  }
}

describe("UpdateInstallRecoveryService", () => {
  it("repairs a first failed install exactly once", async () => {
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 1,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "not-started",
      targetVersion: "0.2.32",
    })

    await expect(fixture.service.reconcile("0.2.28")).resolves.toEqual(expect.objectContaining({
      kind: "recover",
      targetVersion: "0.2.32",
    }))
    expect(fixture.processRunner.run).toHaveBeenCalledTimes(2)
    expect(fixture.runProcess).toHaveBeenNthCalledWith(1, expect.objectContaining({
      args: ["print", "gui/501/com.fairyever.synapse.ShipIt"],
    }))
    expect(fixture.runProcess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: ["bootout", "gui/501/com.fairyever.synapse.ShipIt"],
    }))
    expect(fixture.removePath.mock.calls.map(([target]) => target)).toEqual([
      "/Users/test/Library/Caches/@synapsedesktop-updater",
      "/Users/test/Library/Caches/com.fairyever.synapse.ShipIt",
    ])
    expect(fixture.current().pendingAttempt).toEqual(expect.objectContaining({
      installAttempts: 1,
      recoveryPhase: "prepared",
    }))

    await expect(fixture.service.reconcile("0.2.28")).resolves.toEqual(expect.objectContaining({
      kind: "resume",
    }))
    expect(fixture.processRunner.run).toHaveBeenCalledTimes(2)
    expect(fixture.removePath).toHaveBeenCalledTimes(2)
  })

  it("does not count an ordinary restart before the recovered install as a second failure", async () => {
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 1,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "prepared",
      targetVersion: "0.2.32",
    })

    await expect(fixture.service.reconcile("0.2.28")).resolves.toEqual(expect.objectContaining({
      kind: "resume",
    }))
    expect(fixture.current().pendingAttempt?.installAttempts).toBe(1)
  })

  it("moves a failed second install to manual recovery without another cleanup", async () => {
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 1,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "prepared",
      targetVersion: "0.2.32",
    })

    await fixture.service.recordInstallAttempt("0.2.32", DMG_URL)
    expect(fixture.current().pendingAttempt?.installAttempts).toBe(2)

    await expect(fixture.service.reconcile("0.2.28")).resolves.toEqual({
      kind: "manual",
      manualInstallerUrl: DMG_URL,
      targetVersion: "0.2.32",
    })
    expect(fixture.processRunner.run).not.toHaveBeenCalled()
    expect(fixture.removePath).not.toHaveBeenCalled()
  })

  it("clears a pending attempt after the installed version reaches the target", async () => {
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 2,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "prepared",
      targetVersion: "0.2.32",
    })

    await expect(fixture.service.reconcile("0.2.33")).resolves.toEqual({ kind: "none" })
    expect(fixture.current().pendingAttempt).toBeNull()
  })

  it("falls back to manual recovery when cache cleanup permission is denied", async () => {
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 1,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "not-started",
      targetVersion: "0.2.32",
    })
    fixture.permissionGuard.check.mockResolvedValueOnce({
      allowed: false,
      policyId: "test-policy",
      reason: "denied",
    })

    await expect(fixture.service.reconcile("0.2.28")).resolves.toEqual({
      kind: "manual",
      manualInstallerUrl: DMG_URL,
      targetVersion: "0.2.32",
    })
    expect(fixture.current().pendingAttempt?.recoveryPhase).toBe("manual-required")
    expect(fixture.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      outcome: "denied",
    }))
  })

  it("falls back without deleting caches when launchctl fails unexpectedly", async () => {
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 1,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "not-started",
      targetVersion: "0.2.32",
    })
    fixture.runProcess
      .mockResolvedValueOnce({
        durationMs: 1,
        exitCode: 0,
        signal: null,
        stdout: "state = waiting\nruns = 0\nlast exit code = (never exited)\n",
        timedOut: false,
      })
      .mockResolvedValueOnce({
      durationMs: 1,
      exitCode: 5,
      signal: null,
      stderr: "unexpected launchctl failure",
      timedOut: false,
      })

    await expect(fixture.service.reconcile("0.2.28")).resolves.toEqual(expect.objectContaining({
      kind: "manual",
    }))
    expect(fixture.removePath).not.toHaveBeenCalled()
  })

  it("continues cleanup when the stale launch service is already absent", async () => {
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 1,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "not-started",
      targetVersion: "0.2.32",
    })
    fixture.runProcess
      .mockResolvedValueOnce({
        durationMs: 1,
        exitCode: 113,
        signal: null,
        stderr: "Could not find service",
        timedOut: false,
      })
      .mockResolvedValueOnce({
      durationMs: 1,
      exitCode: 5,
      signal: null,
      stderr: "Could not find service",
      timedOut: false,
      })

    await expect(fixture.service.reconcile("0.2.28")).resolves.toEqual(expect.objectContaining({
      kind: "recover",
    }))
    expect(fixture.removePath).toHaveBeenCalledTimes(2)
  })

  it("records the ShipIt launch service state before removing it", async () => {
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 1,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "not-started",
      targetVersion: "0.2.32",
    })
    fixture.runProcess.mockResolvedValueOnce({
      durationMs: 1,
      exitCode: 0,
      signal: null,
      stdout: [
        "state = waiting",
        "runs = 0",
        "last exit code = (never exited)",
        "pended nondemand spawn = semaphore",
      ].join("\n"),
      timedOut: false,
    })

    await fixture.service.reconcile("0.2.28")

    expect(loggerMock.info).toHaveBeenCalledWith(
      "Captured ShipIt launch service state before recovery.",
      expect.objectContaining({
        lastExitCode: "(never exited)",
        pendingNonDemandSpawn: true,
        runs: "0",
        serviceFound: true,
        state: "waiting",
      }),
    )
  })
})
