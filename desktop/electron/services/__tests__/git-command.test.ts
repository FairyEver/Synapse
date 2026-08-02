import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  configureGitCommandSecurity,
  isGitRebaseInProgress,
  resetGitCommandSecurityForTests,
  runGitCommand,
} from "../git-command"

const roots: string[] = []

async function createTempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-git-command-"))
  roots.push(root)
  return root
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runGitCommand({
    args,
    cwd,
    fallbackMessage: `git ${args.join(" ")} failed`,
  })
  return result.stdout.trim()
}

describe("git-command helpers", () => {
  afterEach(async () => {
    resetGitCommandSecurityForTests()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it("routes git commands through the configured controlled process runner", async () => {
    const run = vi.fn(async () => ({
      durationMs: 12,
      exitCode: 0,
      signal: null,
      stdout: "abc\n",
      stderr: "",
      timedOut: false,
    }))
    configureGitCommandSecurity({
      processRunner: { run },
      actor: { kind: "system", id: "repository-git" },
    })

    const result = await runGitCommand({
      args: ["rev-parse", "--show-toplevel"],
      cwd: "/repo",
      fallbackMessage: "probe failed",
    })

    expect(result.stdout).toBe("abc\n")
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      actor: { kind: "system", id: "repository-git" },
      command: "git",
      args: ["rev-parse", "--show-toplevel"],
      cwd: "/repo",
      env: {
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
      metadata: {
        source: "git-command",
        gitArgs: ["rev-parse", "--show-toplevel"],
      },
    }))
  })

  it("passes only the dedicated temporary index variable to controlled Git commands", async () => {
    const run = vi.fn(async () => ({
      durationMs: 1,
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
    }))
    configureGitCommandSecurity({ processRunner: { run } })

    await runGitCommand({
      args: ["read-tree", "HEAD"],
      cwd: "/repo",
      fallbackMessage: "read tree failed",
      gitIndexFile: "/repo/.git/synapse-index-test/index",
    })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        GIT_INDEX_FILE: "/repo/.git/synapse-index-test/index",
      }),
      envAllowlist: ["GIT_INDEX_FILE", "GIT_TERMINAL_PROMPT", "LANG", "LC_ALL"],
    }))
  })

  it("detects rebase state in a Git worktree", async () => {
    const root = await createTempDir()
    const repoPath = path.join(root, "repo")
    const worktreePath = path.join(root, "worktree")
    await mkdir(repoPath)
    await git(repoPath, ["init"])
    await git(repoPath, ["config", "user.name", "Synapse Test"])
    await git(repoPath, ["config", "user.email", "synapse@example.test"])
    await writeFile(path.join(repoPath, "README.md"), "# Repo\n")
    await git(repoPath, ["add", "README.md"])
    await git(repoPath, ["commit", "-m", "init"])
    await git(repoPath, ["worktree", "add", worktreePath])

    expect(await isGitRebaseInProgress(worktreePath)).toBe(false)

    const rebaseMergePath = await git(worktreePath, ["rev-parse", "--git-path", "rebase-merge"])
    await mkdir(path.isAbsolute(rebaseMergePath) ? rebaseMergePath : path.join(worktreePath, rebaseMergePath), { recursive: true })

    expect(await isGitRebaseInProgress(worktreePath)).toBe(true)
  })
})
