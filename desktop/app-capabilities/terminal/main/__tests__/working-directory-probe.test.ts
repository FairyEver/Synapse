import { describe, expect, it, vi } from "vitest"

import type { ControlledProcessRunner } from "../../../../electron/runtime/process"
import type { AuditEvent, AuditSink, PermissionGuard, PermissionResult } from "../../../../electron/runtime/security"
import {
  createTerminalWorkingDirectoryProbe,
  parseForegroundPid,
  parseLsofCwd,
} from "../working-directory-probe"

type RunRequest = Parameters<ControlledProcessRunner["run"]>[0]

function createRunner(handler: (request: RunRequest) => { exitCode: number; stdout: string } | Error) {
  const calls: RunRequest[] = []
  const run = vi.fn(async (request: RunRequest) => {
    calls.push(request)
    const outcome = handler(request)
    if (outcome instanceof Error) throw outcome
    return {
      exitCode: outcome.exitCode,
      signal: null,
      stdout: outcome.stdout,
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }
  })
  return { runner: { run } as unknown as Pick<ControlledProcessRunner, "run">, calls, run }
}

function createHarness(options: {
  runner: Pick<ControlledProcessRunner, "run">
  permission?: PermissionGuard["check"]
}) {
  const audit: AuditEvent[] = []
  const auditSink = { record: (event: AuditEvent) => { audit.push(event) } } as unknown as AuditSink
  const permissionGuard = {
    check: options.permission ?? (async () => ({ allowed: true }) as PermissionResult),
    registerPolicy: vi.fn(() => () => {}),
  } as unknown as PermissionGuard
  return {
    audit,
    probe: createTerminalWorkingDirectoryProbe({ processRunner: options.runner, permissionGuard, auditSink }),
  }
}

/** 真实的 `ps -t` 输出形状：pid、stat，前台进程组带 `+`。 */
const PS_OUTPUT = "  9411 Ss+\n  9480 S+\n"
const LSOF_OUTPUT = "p9480\nfcwd\nn/Users/liyang/Documents/code/github/Synapse\n"

describe("parseForegroundPid / parseLsofCwd", () => {
  it("reads the pid and the cwd out of the real command shapes", () => {
    expect(parseForegroundPid(PS_OUTPUT)).toBe(9411)
    expect(parseForegroundPid("")).toBeNull()
    expect(parseForegroundPid("garbage\n\n")).toBeNull()
    expect(parseLsofCwd(LSOF_OUTPUT)).toBe("/Users/liyang/Documents/code/github/Synapse")
    expect(parseLsofCwd("")).toBeNull()
    expect(parseLsofCwd("p1\nfcwd\n")).toBeNull()
  })

  it("prefers the process in the foreground process group", () => {
    expect(parseForegroundPid("  100 S\n  200 S+\n")).toBe(200)
    expect(parseForegroundPid("  100 S\n  200 S\n")).toBe(100)
  })
})

describe("createTerminalWorkingDirectoryProbe", () => {
  it("reads ps and lsof and returns the directory", async () => {
    const { runner, calls } = createRunner((request) =>
      request.command === "ps"
        ? { exitCode: 0, stdout: PS_OUTPUT }
        : { exitCode: 0, stdout: LSOF_OUTPUT })
    const harness = createHarness({ runner })

    await expect(harness.probe.probe({ sessionId: "s1", watermark: 1, tty: "/dev/ttys006" }))
      .resolves.toBe("/Users/liyang/Documents/code/github/Synapse")

    expect(calls.map((call) => [call.command, ...(call.args ?? [])])).toEqual([
      ["ps", "-t", "/dev/ttys006", "-o", "pid=", "-o", "stat="],
      ["lsof", "-a", "-d", "cwd", "-p", "9411", "-Fn"],
    ])
    // 权限动作是那个窄动作，不是 shell.exec。
    expect(calls.every((call) => call.action === "process.cwd_probe")).toBe(true)
  })

  it("falls back to the PTY pid when ps finds nothing", async () => {
    const { runner, calls } = createRunner((request) =>
      request.command === "ps"
        ? { exitCode: 1, stdout: "" }
        : { exitCode: 0, stdout: LSOF_OUTPUT })
    const harness = createHarness({ runner })

    await expect(harness.probe.probe({ sessionId: "s1", watermark: 1, tty: "/dev/ttys006", pid: 4242 }))
      .resolves.toBe("/Users/liyang/Documents/code/github/Synapse")
    expect(calls[1]?.args).toEqual(["-a", "-d", "cwd", "-p", "4242", "-Fn"])
  })

  it("returns null without running anything when the tty is unknown", async () => {
    const { runner, run } = createRunner(() => ({ exitCode: 0, stdout: LSOF_OUTPUT }))
    const harness = createHarness({ runner })
    await expect(harness.probe.probe({ sessionId: "s1", watermark: 1 })).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it("returns null instead of throwing when the commands fail, time out or talk nonsense", async () => {
    const failures = [
      createRunner(() => new Error("lsof timed out")),
      createRunner((request) => (request.command === "ps"
        ? { exitCode: 0, stdout: "not a pid table" }
        : { exitCode: 1, stdout: "" })),
      createRunner(() => ({ exitCode: 1, stdout: "p1\nfcwd\n" })),
    ]
    for (const failure of failures) {
      const harness = createHarness({ runner: failure.runner })
      await expect(harness.probe.probe({ sessionId: "s1", watermark: 1, tty: "/dev/ttys006", pid: 1 }))
        .resolves.toBeNull()
    }
  })

  it("probes once per output watermark and forgets the answer when the watermark moves", async () => {
    const { runner, run } = createRunner((request) =>
      request.command === "ps"
        ? { exitCode: 0, stdout: PS_OUTPUT }
        : { exitCode: 0, stdout: LSOF_OUTPUT })
    const harness = createHarness({ runner })
    const input = { sessionId: "s1", watermark: 7, tty: "/dev/ttys006" }

    await harness.probe.probe(input)
    await harness.probe.probe(input)
    expect(run).toHaveBeenCalledTimes(2) // ps + lsof，只跑了一轮

    // 纯读口径：同一个水位读得到，水位一动就读不到。
    expect(harness.probe.read({ sessionId: "s1", watermark: 7 })).toBe("/Users/liyang/Documents/code/github/Synapse")
    expect(harness.probe.read({ sessionId: "s1", watermark: 8 })).toBeUndefined()

    await harness.probe.probe({ ...input, watermark: 8 })
    expect(run).toHaveBeenCalledTimes(4)

    harness.probe.forget("s1")
    expect(harness.probe.read({ sessionId: "s1", watermark: 8 })).toBeUndefined()
  })

  it("returns null and records one denial when the guard refuses the probe", async () => {
    const { runner, run } = createRunner(() => ({ exitCode: 0, stdout: LSOF_OUTPUT }))
    const harness = createHarness({
      runner,
      permission: async () => ({ allowed: false, reason: "denied by test", policyId: "test" }),
    })

    await expect(harness.probe.probe({ sessionId: "s1", watermark: 1, tty: "/dev/ttys006" }))
      .resolves.toBeNull()
    // 被拒之后不再去执行：否则受控执行器会再记一条 denied。
    expect(run).not.toHaveBeenCalled()
    expect(harness.audit).toEqual([
      expect.objectContaining({ action: "process.cwd_probe", outcome: "denied", resource: "/dev/ttys006" }),
    ])
  })

  it("returns null and records one failure when the guard itself throws", async () => {
    const { runner, run } = createRunner(() => ({ exitCode: 0, stdout: LSOF_OUTPUT }))
    const harness = createHarness({
      runner,
      permission: async () => { throw new Error("guard exploded") },
    })

    await expect(harness.probe.probe({ sessionId: "s1", watermark: 1, tty: "/dev/ttys006" }))
      .resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
    expect(harness.audit).toEqual([
      expect.objectContaining({ outcome: "failed", resource: "/dev/ttys006" }),
    ])
  })
})
