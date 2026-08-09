import { describe, expect, it, vi } from "vitest"
import { categorizeGitError, createGitClientCommandRunner, getGitUserFacingFailure } from "../git-command-runner"

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
      output: "Authorization: Basic dXNlcjpzZWNyZXQ=\nAuthorization: Bearer raw.bearer.token\nCookie: session=raw-cookie\nfatal: token=raw-token\ncwd: /Users/writer/work/repo",
      stderr: "Authorization: Basic dXNlcjpzZWNyZXQ=\nAuthorization: Bearer raw.bearer.token\nCookie: session=raw-cookie\nfatal: token=raw-token GIT_AUTH_TOKEN=env-secret https://user:secret@git.example.com/team/docs.git\ncwd: /Users/writer/work/repo",
      stdout: "",
      timedOut: false,
    })
    const run = vi.fn().mockRejectedValue(error)
    const runner = createGitClientCommandRunner({ logger, runGitCommand: run })

    await expect(runner.run({
      cwd: "/Users/writer/work/repo",
      args: ["push", "https://user:secret@git.example.com/team/docs.git?token=raw-token"],
      operation: "git.push",
      operationId: "git-op-1",
      repositoryId: "repo-1",
      repoPath: "C:\\Users\\writer\\work\\repo",
    })).rejects.toThrow("Authentication failed")

    expect(logger.error).toHaveBeenCalledWith("Git command failed.", expect.objectContaining({
      operation: "git.push",
      operationId: "git-op-1",
      repositoryId: "repo-1",
      repoPath: "[path redacted]/repo",
      cwd: "[path redacted]/repo",
      exitCode: 128,
      stderrPreview: expect.stringContaining("[redacted]"),
    }))
    const serialized = JSON.stringify(logger.error.mock.calls)
    expect(serialized).not.toContain("/Users/writer/work/repo")
    expect(serialized).not.toContain("C:\\\\Users\\\\writer\\\\work\\\\repo")
    expect(serialized).not.toContain("dXNlcjpzZWNyZXQ")
    expect(serialized).not.toContain("raw-token")
    expect(serialized).not.toContain("raw.bearer.token")
    expect(serialized).not.toContain("raw-cookie")
    expect(serialized).not.toContain("env-secret")
    expect(serialized).not.toContain("user:secret")
  })

  it("attaches a non-enumerable sanitized user-facing failure to command errors", async () => {
    const logger = { error: vi.fn() }
    const error = Object.assign(new Error("Authentication failed for https://token:secret@git.company.com/team/docs.git?token=raw-token"), {
      exitCode: 128,
      output: "fatal: Authentication failed for https://token:secret@git.company.com/team/docs.git?token=raw-token",
      stderr: "fatal: could not read Username for 'https://git.company.com': terminal prompts disabled",
      stdout: "",
    })
    const run = vi.fn().mockRejectedValue(error)
    const runner = createGitClientCommandRunner({ logger, runGitCommand: run })

    let caught: unknown
    try {
      await runner.run({
        cwd: "/repo",
        args: ["fetch", "https://token:secret@git.company.com/team/docs.git?token=raw-token"],
        remoteUrl: "https://token:secret@git.company.com/team/docs.git?token=raw-token",
      })
    } catch (runError) {
      caught = runError
    }

    const failure = getGitUserFacingFailure(caught)
    expect(failure).toMatchObject({
      category: "https-auth",
      host: "git.company.com",
      primaryAction: "login-host",
      title: "认证失败",
    })
    expect(Object.keys(caught as Record<string, unknown>)).not.toContain("userFacingFailure")
    const serialized = JSON.stringify(caught)
    expect(serialized).not.toContain("raw-token")
    expect(serialized).not.toContain("token:secret")
  })

  it("wraps non-Error rejections and attaches a sanitized user-facing failure", async () => {
    const run = vi.fn().mockRejectedValue({
      message: "fatal: unable to access 'https://github.com/team/docs.git/': The requested URL returned error: 403",
      output: "Authorization: Basic dXNlcjpzZWNyZXQ=",
      stderr: "Authorization: Bearer raw.bearer.payload",
    })
    const runner = createGitClientCommandRunner({ runGitCommand: run })

    let caught: unknown
    try {
      await runner.run({
        cwd: "/repo",
        args: ["fetch", "origin"],
        logFailure: false,
        remoteUrl: "https://github.com/team/docs.git",
      })
    } catch (runError) {
      caught = runError
    }

    expect(caught).toBeInstanceOf(Error)
    const failure = getGitUserFacingFailure(caught)
    expect(failure).toMatchObject({
      category: "github-auth",
      host: "github.com",
      primaryAction: "handle-github-auth",
      title: "GitHub 需要登录",
    })
    const serializedFailure = JSON.stringify(failure)
    expect(serializedFailure).not.toContain("dXNlcjpzZWNyZXQ")
    expect(serializedFailure).not.toContain("raw.bearer.payload")
  })

  it("attaches failure when Git command diagnostics are read-only", async () => {
    const error = new Error("fatal: unable to access 'https://github.com/team/docs.git/': The requested URL returned error: 403")
    Object.defineProperties(error, {
      code: {
        enumerable: false,
        value: "GIT_EXIT",
        writable: false,
      },
      exitCode: {
        enumerable: false,
        value: 128,
        writable: false,
      },
      output: {
        enumerable: false,
        value: "Authorization: Basic dXNlcjpzZWNyZXQ=",
        writable: false,
      },
      signal: {
        enumerable: false,
        value: "SIGTERM",
        writable: false,
      },
      stderr: {
        enumerable: false,
        value: "Authorization: Bearer raw.bearer.payload",
        writable: false,
      },
      stdout: {
        enumerable: false,
        value: "",
        writable: false,
      },
      timedOut: {
        enumerable: false,
        value: true,
        writable: false,
      },
    })
    const run = vi.fn().mockRejectedValue(error)
    const runner = createGitClientCommandRunner({ runGitCommand: run })

    let caught: unknown
    try {
      await runner.run({
        cwd: "/repo",
        args: ["fetch", "origin"],
        logFailure: false,
        remoteUrl: "https://github.com/team/docs.git",
      })
    } catch (runError) {
      caught = runError
    }

    expect(caught).not.toBeInstanceOf(TypeError)
    const failure = getGitUserFacingFailure(caught)
    expect(failure).toMatchObject({
      category: "github-auth",
      host: "github.com",
      primaryAction: "handle-github-auth",
      title: "GitHub 需要登录",
    })
    expect(getGitUserFacingFailure(error)).toEqual(failure)
    expect(caught).toMatchObject({
      code: "GIT_EXIT",
      exitCode: 128,
      signal: "SIGTERM",
      timedOut: true,
    })
    expect(Object.keys(caught as Record<string, unknown>)).not.toContain("userFacingFailure")
    const serialized = JSON.stringify(caught)
    expect(serialized).not.toContain("dXNlcjpzZWNyZXQ")
    expect(serialized).not.toContain("raw.bearer.payload")
  })
})
