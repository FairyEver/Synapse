import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { isGitRebaseInProgress, runGitCommand } from "../git-command"

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
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
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
