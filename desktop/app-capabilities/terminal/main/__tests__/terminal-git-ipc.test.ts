import { describe, expect, it, vi } from "vitest"

import type { IpcHandlerContext } from "../../../../electron/runtime/ipc/types"
import { terminalGitMethods } from "../terminal-git-ipc"

const snapshot = {
  cwd: "/projects/current",
  isRepository: true,
  branch: "main",
  detachedSha: null,
  upstream: "origin/main",
  ahead: 1,
  behind: 2,
  changeCount: 3,
  hasConflicts: false,
  changes: [{ path: "private-file" }],
}

function context(cwd = snapshot.cwd) {
  const terminal = { probeCurrentWorkingDirectory: vi.fn(async () => cwd) }
  const git = {
    getSnapshot: vi.fn(async () => snapshot),
    sync: vi.fn(async () => ({ ok: true as const, value: snapshot })),
  }
  const ctx = {
    resolve: (id: string) => id === "core.terminal" ? terminal : git,
  } as unknown as IpcHandlerContext
  return { ctx, terminal, git }
}

describe("terminal Git UI IPC", () => {
  it("reads the same probed directory as the file tree and returns only display fields", async () => {
    const { ctx, git, terminal } = context()
    const status = await terminalGitMethods.getGitStatus.handler(ctx, { sessionId: "session-1" })
    expect(terminal.probeCurrentWorkingDirectory).toHaveBeenCalledWith("session-1")
    expect(git.getSnapshot).toHaveBeenCalledWith(snapshot.cwd)
    expect(status).toEqual(expect.objectContaining({ branch: "main", changeCount: 3 }))
    expect(status).not.toHaveProperty("changes")
  })

  it("refuses to sync after the terminal changes directories", async () => {
    const { ctx, git } = context("/projects/other")
    const result = await terminalGitMethods.syncGit.handler(ctx, {
      sessionId: "session-1",
      expectedCwd: snapshot.cwd,
    })
    expect(result).toEqual({ ok: false, message: "终端目录已变化，请刷新后重试。" })
    expect(git.sync).not.toHaveBeenCalled()
  })

  it("syncs the current directory and strips file details from the response", async () => {
    const { ctx, git } = context()
    const result = await terminalGitMethods.syncGit.handler(ctx, {
      sessionId: "session-1",
      expectedCwd: snapshot.cwd,
    })
    expect(git.sync).toHaveBeenCalledWith({ cwd: snapshot.cwd })
    expect(result).toEqual({ ok: true, status: expect.objectContaining({ changeCount: 3 }) })
    if (result && typeof result === "object" && "status" in result) {
      expect(result.status).not.toHaveProperty("changes")
    }
  })
})
