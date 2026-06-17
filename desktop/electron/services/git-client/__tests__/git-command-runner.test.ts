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
})
