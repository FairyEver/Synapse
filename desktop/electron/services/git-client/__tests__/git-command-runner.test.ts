import { describe, expect, it, vi } from "vitest"
import { categorizeGitError, createGitClientCommandRunner } from "../git-command-runner"

describe("categorizeGitError", () => {
  it("maps common Git failures to product categories", () => {
    expect(categorizeGitError(new Error("current system has no git command"))).toBe("git-missing")
    expect(categorizeGitError(new Error("Authentication failed for https://example.com/repo.git"))).toBe("auth-failed")
    expect(categorizeGitError(new Error("Could not resolve host: git.example.com"))).toBe("network-failed")
    expect(categorizeGitError(new Error("not a git repository"))).toBe("not-git-repository")
    expect(categorizeGitError(new Error("Your local changes would be overwritten by checkout"))).toBe("working-tree-dirty")
    expect(categorizeGitError(new Error("non-fast-forward"))).toBe("non-fast-forward")
    expect(categorizeGitError(new Error("CONFLICT (content): Merge conflict"))).toBe("conflict")
  })
})

describe("createGitClientCommandRunner", () => {
  it("passes args as arrays and keeps terminal prompt disabled", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok\n", stderr: "" })
    const runner = createGitClientCommandRunner({ runGitCommand: run })

    await expect(runner.run({ cwd: "/repo", args: ["status", "--porcelain=v2"] })).resolves.toEqual({
      stdout: "ok\n",
      stderr: "",
    })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo",
      args: ["status", "--porcelain=v2"],
      fallbackMessage: "Git 操作失败。",
      timeoutMs: 60000,
    }))
  })

  it("logs failed commands with diagnostics and redacts secrets", async () => {
    const logger = { error: vi.fn() }
    const error = Object.assign(new Error("Authentication failed for https://user:secret@git.example.com/team/docs.git?token=raw-token"), {
      exitCode: 128,
      output: "Authorization: Bearer raw.bearer.token\nCookie: session=raw-cookie\nfatal: token=raw-token",
      stderr: "Authorization: Bearer raw.bearer.token\nCookie: session=raw-cookie\nfatal: token=raw-token GIT_AUTH_TOKEN=env-secret https://user:secret@git.example.com/team/docs.git",
      stdout: "",
      timedOut: false,
    })
    const run = vi.fn().mockRejectedValue(error)
    const runner = createGitClientCommandRunner({ logger, runGitCommand: run })

    await expect(runner.run({
      cwd: "/repo",
      args: ["push", "https://user:secret@git.example.com/team/docs.git?token=raw-token"],
      operation: "git.push",
      operationId: "git-op-1",
      repositoryId: "repo-1",
      repoPath: "/repo",
    })).rejects.toThrow("Authentication failed")

    expect(logger.error).toHaveBeenCalledWith("Git command failed.", expect.objectContaining({
      operation: "git.push",
      operationId: "git-op-1",
      repositoryId: "repo-1",
      repoPath: "/repo",
      exitCode: 128,
      stderrPreview: expect.stringContaining("[redacted]"),
    }))
    const serialized = JSON.stringify(logger.error.mock.calls)
    expect(serialized).not.toContain("raw-token")
    expect(serialized).not.toContain("raw.bearer.token")
    expect(serialized).not.toContain("raw-cookie")
    expect(serialized).not.toContain("env-secret")
    expect(serialized).not.toContain("user:secret")
  })
})
