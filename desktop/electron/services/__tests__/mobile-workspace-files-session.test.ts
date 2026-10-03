import { describe, expect, it, vi } from "vitest"
import { terminalContractError } from "../../../app-capabilities/terminal/shared/errors"
import { resolveMobileWorkspaceFilesSession } from "../mobile-gateway/workspace-files-session"

describe("workspace files session resolution", () => {
  it("uses probed cwd instead of the launch-directory snapshot", async () => {
    const terminal = {
      getSession: vi.fn(() => ({ status: "running", cwd: "/launch", shell: "/bin/zsh" })),
      probeCurrentWorkingDirectory: vi.fn(async () => "/actual/subdirectory"),
    }
    expect(await resolveMobileWorkspaceFilesSession(terminal as never, "session-1")).toEqual({ cwd: "/actual/subdirectory", shell: "/bin/zsh" })
    expect(terminal.probeCurrentWorkingDirectory).toHaveBeenCalledWith("session-1")
  })

  it("does not create scope for a session that ended while cwd was probed", async () => {
    let status = "running"
    const terminal = {
      getSession: () => ({ status, shell: "/bin/zsh" }),
      probeCurrentWorkingDirectory: async () => { status = "ended"; return "/actual" },
    }
    expect(await resolveMobileWorkspaceFilesSession(terminal as never, "session-1")).toBeNull()
  })

  it("distinguishes a removed session from an unexpected resolver failure", async () => {
    const missing = { getSession: () => { throw terminalContractError("not_found", "not_found") }, probeCurrentWorkingDirectory: vi.fn() }
    expect(await resolveMobileWorkspaceFilesSession(missing as never, "session-1")).toBeNull()
    const broken = { getSession: () => { throw new Error("resolver failure") }, probeCurrentWorkingDirectory: vi.fn() }
    await expect(resolveMobileWorkspaceFilesSession(broken as never, "session-1")).rejects.toThrow("resolver failure")
    expect(missing.probeCurrentWorkingDirectory).not.toHaveBeenCalled()
  })
})
