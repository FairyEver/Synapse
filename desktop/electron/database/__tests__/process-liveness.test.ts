import { describe, expect, it, vi } from "vitest"

import { isProcessAlive } from "../../../database/shared/process-liveness"

type ExecFileSync = typeof import("node:child_process").execFileSync

describe("isProcessAlive", () => {
  it("uses tasklist CSV output on Windows without shell interpolation", () => {
    const execFileSync = vi.fn(() => "\"node.exe\",\"1234\",\"Console\",\"1\",\"10,000 K\"\r\n")

    expect(isProcessAlive(1234, {
      platform: "win32",
      execFileSync: execFileSync as unknown as ExecFileSync,
    })).toBe(true)

    expect(execFileSync).toHaveBeenCalledWith("tasklist", [
      "/FI",
      "PID eq 1234",
      "/FO",
      "CSV",
      "/NH",
    ], expect.objectContaining({
      encoding: "utf8",
      windowsHide: true,
    }))
  })

  it("treats Windows tasklist no-match output as not alive", () => {
    const execFileSync = vi.fn(() => "INFO: No tasks are running which match the specified criteria.\r\n")

    expect(isProcessAlive(1234, {
      platform: "win32",
      execFileSync: execFileSync as unknown as ExecFileSync,
    })).toBe(false)
  })

  it("keeps Windows liveness conservative when tasklist fails", () => {
    const execFileSync = vi.fn(() => {
      throw new Error("tasklist failed")
    })

    expect(isProcessAlive(1234, {
      platform: "win32",
      execFileSync: execFileSync as unknown as ExecFileSync,
    })).toBe(true)
  })

  it("uses POSIX kill signal 0 error codes outside Windows", () => {
    const runningKill = vi.fn(() => true)
    const permissionKill = vi.fn(() => {
      throw errorWithCode("EPERM")
    })
    const missingKill = vi.fn(() => {
      throw errorWithCode("ESRCH")
    })

    expect(isProcessAlive(1234, { platform: "darwin", kill: runningKill })).toBe(true)
    expect(isProcessAlive(1234, { platform: "linux", kill: permissionKill })).toBe(true)
    expect(isProcessAlive(1234, { platform: "darwin", kill: missingKill })).toBe(false)
  })

  it("rejects invalid pid values before platform-specific checks", () => {
    const execFileSync = vi.fn()
    const kill = vi.fn()

    expect(isProcessAlive(0, {
      platform: "win32",
      execFileSync: execFileSync as unknown as ExecFileSync,
    })).toBe(false)
    expect(isProcessAlive(Number.NaN, { platform: "linux", kill })).toBe(false)
    expect(execFileSync).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })
})

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}
