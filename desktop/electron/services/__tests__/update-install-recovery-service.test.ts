import { mkdtemp, mkdir, chmod, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import type { DataNamespace } from "../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { ControlledProcessRunner } from "../../runtime/process"
import type { UpdateInstallRecoveryEntryV1 } from "../../runtime/data-repo/schemas/update-install-recovery"
import { readMacUpdateInstallPermissions, UpdateInstallRecoveryService } from "../update-install-recovery-service"

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

function createFixture(
  initial: UpdateInstallRecoveryEntryV1["pendingAttempt"] = null,
  options: {
    readonly useControlledRemoval?: boolean
    readonly getInstallPermissions?: () => ReturnType<typeof readMacUpdateInstallPermissions>
    readonly wait?: (delayMs: number) => Promise<void>
  } = {},
) {
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
    getInstallPermissions: options.getInstallPermissions,
    permissionGuard,
    processRunner,
    removePath: options.useControlledRemoval ? undefined : removePath,
    stateStore,
    wait: options.wait ?? (async () => undefined),
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
  it("waits for an xpcproxy process to become running without restarting ShipIt", async () => {
    const fixture = createFixture()
    const starting = {
      durationMs: 1, exitCode: 0, signal: null, timedOut: false,
      stdout: "state = xpcproxy\npid = 99123\nruns = 1\n",
    }
    fixture.runProcess.mockResolvedValueOnce(starting).mockResolvedValueOnce(starting).mockResolvedValue({
      ...starting, stdout: "state = running\npid = 99123\nruns = 1\n",
    })

    await expect(fixture.service.ensureShipItStarted()).resolves.toBe(true)

    expect(fixture.runProcess.mock.calls.map(([request]) => request.args)).toEqual([
      ["print", "gui/501/com.fairyever.synapse.ShipIt"],
      ["print", "gui/501/com.fairyever.synapse.ShipIt"],
      ["print", "gui/501/com.fairyever.synapse.ShipIt"],
    ])
    expect(loggerMock.info).toHaveBeenCalledWith(
      "Verified that the ShipIt process is running before app quit.",
      expect.objectContaining({ kickstarted: false, pid: "99123", state: "running" }),
    )
  })

  it("fails within the startup deadline when xpcproxy never becomes running", async () => {
    let now = 1_000
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now)
    try {
      const fixture = createFixture(null, { wait: async delayMs => { now += delayMs } })
      fixture.runProcess.mockResolvedValue({
        durationMs: 1, exitCode: 0, signal: null, timedOut: false,
        stdout: "state = xpcproxy\npid = 99123\nruns = 1\n",
      })

      await expect(fixture.service.ensureShipItStarted()).resolves.toBe(false)

      expect(now).toBe(11_000)
      expect(fixture.runProcess.mock.calls.every(([request]) => request.args?.[0] === "print")).toBe(true)
    } finally {
      clock.mockRestore()
    }
  })

  it("stops observing xpcproxy when startup verification is cancelled", async () => {
    const controller = new AbortController()
    const fixture = createFixture(null, { wait: async () => { controller.abort() } })
    fixture.runProcess.mockResolvedValue({
      durationMs: 1, exitCode: 0, signal: null, timedOut: false,
      stdout: "state = xpcproxy\npid = 99123\nruns = 1\n",
    })

    await expect(fixture.service.ensureShipItStarted(controller.signal)).resolves.toBe(false)

    expect(controller.signal.aborted).toBe(true)
    expect(fixture.runProcess).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      args: ["print", "gui/501/com.fairyever.synapse.ShipIt"], abortSignal: controller.signal,
    }))
  })

  it.each([
    "state = not running\nruns = 2\nlast exit code = 0\n",
    "state = waiting\nruns = 1\n",
    "state = waiting\n",
    "state = xpcproxy\nruns = 1\n",
    "state = xpcproxy\npid = 0\nruns = 1\n",
  ])("does not restart a historical or unverified ShipIt job: %s", async (stdout) => {
    const fixture = createFixture()
    fixture.runProcess.mockResolvedValueOnce({
      durationMs: 1, exitCode: 0, signal: null, stdout, timedOut: false,
    }).mockResolvedValue({
      durationMs: 1, exitCode: 1, signal: null, timedOut: false,
    })

    await expect(fixture.service.ensureShipItStarted()).resolves.toBe(false)

    expect(fixture.runProcess).toHaveBeenCalledTimes(1)
    expect(fixture.runProcess.mock.calls.some(([request]) => request.args?.[0] === "kickstart")).toBe(false)
  })

  it.each(["running", "xpcproxy"])("does not trust a truncated %s ShipIt snapshot", async (state) => {
    const fixture = createFixture()
    fixture.runProcess.mockResolvedValue({
      durationMs: 1, exitCode: 0, signal: null, timedOut: false, stdoutTruncated: true,
      stdout: `state = ${state}\npid = 99123\nruns = 1\n`,
    })

    await expect(fixture.service.ensureShipItStarted()).resolves.toBe(false)
    expect(fixture.runProcess).toHaveBeenCalledTimes(1)
  })

  it.each([
    { exitCode: 0, stdout: "state = waiting\nruns = 0\n" },
    { exitCode: 0, stdout: "state = running\npid = 88123\nruns = 1\n" },
    { exitCode: 1, stderr: "Permission denied" },
    { exitCode: null, signal: "SIGTERM" as const, stderr: "Could not find service" },
    { exitCode: 113, stderrTruncated: true, stderr: "Could not find service" },
  ])("does not kickstart a user job when the system job is present or unverifiable: %s", async (systemJob) => {
    const fixture = createFixture()
    fixture.runProcess
      .mockResolvedValueOnce({
        durationMs: 1, exitCode: 0, signal: null, timedOut: false,
        stdout: "state = waiting\nruns = 0\n",
      })
      .mockResolvedValueOnce({ durationMs: 1, signal: null, timedOut: false, ...systemJob })
      .mockResolvedValue({
        durationMs: 1, exitCode: 0, signal: null, timedOut: false,
        stdout: "state = running\npid = 99123\nruns = 1\n",
      })

    await expect(fixture.service.ensureShipItStarted()).resolves.toBe(false)

    expect(fixture.runProcess).toHaveBeenNthCalledWith(2, expect.objectContaining({
      args: ["print", "system/com.fairyever.synapse.ShipIt"],
    }))
    expect(fixture.runProcess.mock.calls.some(([request]) => request.args?.[0] === "kickstart")).toBe(false)
  })

  it("records install permissions before persisting the install request", async () => {
    const permissions = {
      bundle: { uid: 0, gid: 0, mode: "755", writable: false },
      parent: { uid: 0, gid: 80, mode: "775", writable: true },
    }
    const getInstallPermissions = vi.fn(async () => permissions)
    const fixture = createFixture(null, { getInstallPermissions })

    await fixture.service.recordInstallAttempt("0.2.32", DMG_URL)

    expect(getInstallPermissions).toHaveBeenCalledTimes(1)
    expect(loggerMock.info).toHaveBeenCalledWith(
      "Captured macOS update install permissions before native handoff.",
      expect.objectContaining({ permissions, uid: 501 }),
    )
    expect(getInstallPermissions.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fixture.stateStore.setSingleton).mock.invocationCallOrder[0]!,
    )
  })

  it("keeps permission diagnostics failures from blocking an install request", async () => {
    const fixture = createFixture(null, {
      getInstallPermissions: async () => { throw new Error("permission probe failed") },
    })

    await fixture.service.recordInstallAttempt("0.2.32", DMG_URL)

    expect(fixture.current().pendingAttempt?.targetVersion).toBe("0.2.32")
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Unable to inspect macOS update install permissions.", expect.anything(),
    )
  })

  it("does not treat a pending launchd job as a running ShipIt process", async () => {
    const fixture = createFixture()
    fixture.runProcess
      .mockResolvedValueOnce({
        durationMs: 1,
        exitCode: 0,
        signal: null,
        stdout: "state = waiting\nruns = 0\npended nondemand spawn = semaphore\n",
        timedOut: false,
      })
      .mockResolvedValueOnce({
        durationMs: 1, exitCode: 113, signal: null, timedOut: false,
        stderr: "Could not find service",
      })
      .mockResolvedValueOnce({
        durationMs: 1,
        exitCode: 0,
        signal: null,
        stdout: "",
        timedOut: false,
      })
      .mockResolvedValueOnce({
        durationMs: 1,
        exitCode: 0,
        signal: null,
        stdout: "state = running\npid = 99123\nruns = 1\n",
        timedOut: false,
      })

    await expect(fixture.service.ensureShipItStarted()).resolves.toBe(true)

    expect(fixture.runProcess).toHaveBeenNthCalledWith(3, expect.objectContaining({
      args: ["kickstart", "gui/501/com.fairyever.synapse.ShipIt"],
    }))
    expect(loggerMock.info).toHaveBeenCalledWith(
      "Verified that the ShipIt process is running before app quit.",
      expect.objectContaining({ kickstarted: true, pid: "99123", state: "running" }),
    )
  })

  it("refuses handoff when launchd cannot start ShipIt", async () => {
    const fixture = createFixture()
    fixture.runProcess
      .mockResolvedValueOnce({
        durationMs: 1,
        exitCode: 0,
        signal: null,
        stdout: "state = waiting\nruns = 0\npended nondemand spawn = semaphore\n",
        timedOut: false,
      })
      .mockResolvedValueOnce({
        durationMs: 1, exitCode: 113, signal: null, timedOut: false,
        stderr: "Could not find service",
      })
      .mockResolvedValueOnce({
        durationMs: 1,
        exitCode: 5,
        signal: null,
        stderr: "kickstart failed",
        timedOut: false,
      })

    await expect(fixture.service.ensureShipItStarted()).resolves.toBe(false)
  })

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
    expect(fixture.removePath).toHaveBeenNthCalledWith(1, expect.any(String))
    expect(fixture.removePath).toHaveBeenNthCalledWith(2, expect.any(String))
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

  it("removes only the two exact updater caches through the controlled runner", async () => {
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 1,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "not-started",
      targetVersion: "0.2.32",
    }, { useControlledRemoval: true })

    await expect(fixture.service.reconcile("0.2.28")).resolves.toEqual(expect.objectContaining({
      kind: "recover",
    }))

    expect(fixture.runProcess).toHaveBeenNthCalledWith(3, expect.objectContaining({
      command: "/bin/rm",
      args: ["-rf", "/Users/test/Library/Caches/@synapsedesktop-updater"],
      timeoutMs: expect.any(Number),
    }))
    expect(fixture.runProcess).toHaveBeenNthCalledWith(4, expect.objectContaining({
      command: "/bin/rm",
      args: ["-rf", "/Users/test/Library/Caches/com.fairyever.synapse.ShipIt"],
      timeoutMs: expect.any(Number),
    }))
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

  it("hard-times out a stuck cache removal and falls back to manual recovery", async () => {
    vi.useFakeTimers()
    const fixture = createFixture({
      attemptedAt: "2026-08-11T00:00:00.000Z",
      installAttempts: 1,
      manualInstallerUrl: DMG_URL,
      recoveryPhase: "not-started",
      targetVersion: "0.2.32",
    })
    fixture.removePath.mockImplementationOnce(() => new Promise<void>(() => {}))

    const recovery = fixture.service.reconcile("0.2.28")
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(recovery).resolves.toEqual(expect.objectContaining({ kind: "manual" }))
    expect(fixture.current().pendingAttempt?.recoveryPhase).toBe("manual-required")
    vi.useRealTimers()
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

describe("readMacUpdateInstallPermissions", () => {
  it.skipIf(process.platform === "win32")("distinguishes an unwritable bundle from its writable parent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "synapse-update-permissions-"))
    const bundle = path.join(root, "Synapse.app")
    await mkdir(bundle, { mode: 0o755 })
    try {
      await chmod(bundle, 0o555)
      const result = await readMacUpdateInstallPermissions(bundle)
      expect(result.bundle).toMatchObject({ uid: process.getuid?.(), mode: "555", writable: false })
      expect(result.parent).toMatchObject({ uid: process.getuid?.(), writable: true })
    } finally {
      await chmod(bundle, 0o755)
      await rm(root, { recursive: true })
    }
  })

  it("reports a missing bundle as a diagnostic failure", async () => {
    await expect(readMacUpdateInstallPermissions("/missing-synapse-update-bundle/Synapse.app"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })
})
