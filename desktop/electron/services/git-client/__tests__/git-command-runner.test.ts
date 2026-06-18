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
    const logger = createLoggerHarness()
    const runner = createGitClientCommandRunner({ logger, runGitCommand: run })

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

  it("logs failed commands with operationId, exit code, and redacted output summaries", async () => {
    const error = Object.assign(new Error(
      "Authentication failed for https://user:secret@git.example.com/team/docs.git",
    ), {
      exitCode: 128,
      stderr: "fatal: Authentication failed for https://user:secret@git.example.com/team/docs.git\nAuthorization: Bearer token-secret",
      stdout: "",
    })
    const run = vi.fn().mockRejectedValue(error)
    const logger = createLoggerHarness()
    const runner = createGitClientCommandRunner({ logger, runGitCommand: run })

    await expect(runner.run({
      cwd: "/repo",
      args: ["clone", "https://user:secret@git.example.com/team/docs.git", "/repo"],
      operation: "git.clone",
      operationId: "op-1",
    })).rejects.toThrow("Authentication failed")

    expect(logger.error).toHaveBeenCalledWith("Git command failed.", expect.objectContaining({
      errorCategory: "auth-failed",
      exitCode: 128,
      operation: "git.clone",
      operationId: "op-1",
      stderrSummary: expect.stringContaining("https://[redacted]@git.example.com/team/docs.git"),
    }))
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("token-secret")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("user:secret")
  })

  it("can suppress expected probe failures", async () => {
    const run = vi.fn().mockRejectedValue(new Error("exit code 1"))
    const logger = createLoggerHarness()
    const runner = createGitClientCommandRunner({ logger, runGitCommand: run })

    await expect(runner.run({
      cwd: "/repo",
      args: ["config", "--global", "user.name"],
      logFailure: false,
    })).rejects.toThrow("exit code 1")

    expect(logger.error).not.toHaveBeenCalled()
  })
})

function createLoggerHarness() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
}
