import { execFile } from "node:child_process"
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import type { SynapseGitRepository } from "../../../../src/types/git"
import { createGitCloneService } from "../git-clone-service"
import { createGitClientCommandRunner } from "../git-command-runner"
import { createGitBranchService } from "../git-branch-service"
import { createGitCommitService } from "../git-commit-service"
import { createGitHistoryService } from "../git-history-service"
import { createGitStatusService } from "../git-status-service"
import { createGitSyncService } from "../git-sync-service"

const runFile = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runFile("git", args, { cwd, env: { ...process.env, LANG: "C", LC_ALL: "C" } })
  return result.stdout
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "synapse-git-integration-"))
  roots.push(root)
  return root
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function initializeRepository(localPath: string): Promise<SynapseGitRepository> {
  await mkdir(localPath, { recursive: true })
  await git(localPath, "init", "-b", "main")
  await git(localPath, "config", "user.name", "Synapse Test")
  await git(localPath, "config", "user.email", "synapse@example.com")
  return { id: "repo-1", name: "repo", localPath, addedAt: new Date(0).toISOString(), lastOpenedAt: null }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe("Git client real repository integration", () => {
  it("clones into a child directory of the selected parent", async () => {
    const root = await createRoot()
    const remotePath = path.join(root, "remote.git")
    const parentDirectory = path.join(root, "clones")
    await mkdir(parentDirectory)
    await git(root, "init", "--bare", remotePath)
    const runner = createGitClientCommandRunner()
    const service = createGitCloneService({
      commandRunner: runner,
      pathExists,
      registry: {
        addLocal: async ({ name, localPath }) => ({ id: "clone-1", name, localPath, addedAt: new Date(0).toISOString(), lastOpenedAt: null }),
      },
    })

    const result = await service.clone({ remoteUrl: remotePath, parentDirectory, directoryName: "docs" })

    expect(result.repository.localPath).toBe(path.join(parentDirectory, "docs"))
    await expect(git(result.repository.localPath, "rev-parse", "--show-toplevel"))
      .resolves.toContain(path.join(parentDirectory, "docs"))
  })

  it("previews and commits the complete selected file despite mixed index state", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    const filePath = path.join(repository.localPath, "notes.txt")
    await writeFile(filePath, "base\n", "utf8")
    await git(repository.localPath, "add", "notes.txt")
    await git(repository.localPath, "commit", "-m", "base")
    await writeFile(filePath, "staged\n", "utf8")
    await git(repository.localPath, "add", "notes.txt")
    await writeFile(filePath, "working-tree\n", "utf8")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const commit = createGitCommitService({ commandRunner: runner, getSnapshot: status.getSnapshot })

    const diff = await status.getDiff(repository, { path: "notes.txt", status: "modified" })
    await commit.commit(repository, { message: "complete file", paths: ["notes.txt"] })

    expect(diff.text).toContain("+working-tree")
    await expect(git(repository.localPath, "show", "HEAD:notes.txt")).resolves.toBe("working-tree\n")
  })

  it("renders an untracked file as a /dev/null-to-file diff", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await writeFile(path.join(repository.localPath, "new.txt"), "new content\n", "utf8")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })

    const diff = await status.getDiff(repository, { path: "new.txt", status: "untracked" })

    expect(diff.binary).toBe(false)
    expect(diff.text).toContain("--- /dev/null")
    expect(diff.text).toContain("+new content")
  })

  it("sets upstream on the first push to the explicitly selected remote", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    const remotePath = path.join(root, "remote.git")
    await git(root, "init", "--bare", remotePath)
    await writeFile(path.join(repository.localPath, "README.md"), "docs\n", "utf8")
    await git(repository.localPath, "add", "README.md")
    await git(repository.localPath, "commit", "-m", "initial")
    await git(repository.localPath, "remote", "add", "company", remotePath)
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const sync = createGitSyncService({ commandRunner: runner, getSnapshot: status.getSnapshot })

    await sync.push(repository, "company")

    await expect(git(repository.localPath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"))
      .resolves.toBe("company/main\n")
  })

  it("lists every nested untracked file even when repository config hides them", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await mkdir(path.join(repository.localPath, "docs"))
    await writeFile(path.join(repository.localPath, "docs", "a.md"), "a\n", "utf8")
    await writeFile(path.join(repository.localPath, "docs", "b.md"), "b\n", "utf8")
    await git(repository.localPath, "config", "status.showUntrackedFiles", "no")
    const status = createGitStatusService({ commandRunner: createGitClientCommandRunner(), pathExists })

    const snapshot = await status.getSnapshot(repository)

    expect(snapshot.changes.map((change) => change.path)).toEqual(["docs/a.md", "docs/b.md"])
  })

  it("reports a deleted upstream branch instead of synchronized", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    const remotePath = path.join(root, "remote.git")
    await git(root, "init", "--bare", remotePath)
    await writeFile(path.join(repository.localPath, "README.md"), "docs\n", "utf8")
    await git(repository.localPath, "add", "README.md")
    await git(repository.localPath, "commit", "-m", "initial")
    await git(repository.localPath, "remote", "add", "origin", remotePath)
    await git(repository.localPath, "push", "--set-upstream", "origin", "main")
    await git(remotePath, "update-ref", "-d", "refs/heads/main")
    await git(repository.localPath, "fetch", "--prune")
    const status = createGitStatusService({ commandRunner: createGitClientCommandRunner(), pathExists })

    await expect(status.getSnapshot(repository)).resolves.toMatchObject({
      upstream: "origin/main",
      trackingStatus: "gone",
      ahead: 0,
      behind: 0,
    })
  })

  it("lists worktree branches without Git decoration prefixes", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await writeFile(path.join(repository.localPath, "README.md"), "docs\n", "utf8")
    await git(repository.localPath, "add", "README.md")
    await git(repository.localPath, "commit", "-m", "initial")
    await git(repository.localPath, "worktree", "add", "-b", "secondary", path.join(root, "secondary"))
    const branches = createGitBranchService({
      commandRunner: createGitClientCommandRunner(),
      getSnapshot: async () => ({ changes: [] }),
    })

    await expect(branches.list(repository)).resolves.toEqual([
      { name: "main", current: true },
      { name: "secondary", current: false },
    ])
  })

  it("reads empty subjects, unicode paths, and renames from commit history", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await writeFile(path.join(repository.localPath, "旧 名称.md"), "内容\n", "utf8")
    await git(repository.localPath, "add", "旧 名称.md")
    await git(repository.localPath, "commit", "-m", "initial")
    await git(repository.localPath, "mv", "旧 名称.md", "新 名称.md")
    await git(repository.localPath, "commit", "--allow-empty-message", "-m", "")
    const history = createGitHistoryService({ commandRunner: createGitClientCommandRunner() })

    const commits = await history.list(repository, { limit: 40, offset: 0 })
    expect(commits[0]?.subject).toBe("")
    const detail = await history.getCommit(repository, commits[0]!.hash)
    expect(detail.files).toEqual([
      { path: "新 名称.md", originalPath: "旧 名称.md", status: "renamed", staged: false, conflicted: false },
    ])
  })
})
