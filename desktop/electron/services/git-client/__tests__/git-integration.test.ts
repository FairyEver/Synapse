import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { access, chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import type { SynapseGitRepository } from "../../../../src/types/git"
import type { GitCloneJournalEntryV1 } from "../../../runtime/data-repo"
import { createGitCloneService } from "../git-clone-service"
import { createGitClientCommandRunner } from "../git-command-runner"
import { createGitBranchService } from "../git-branch-service"
import { createGitChangeSelectionService } from "../git-change-selection-service"
import { createGitCommitService } from "../git-commit-service"
import { createGitDiscardService } from "../git-discard-service"
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

function createCloneJournal() {
  const entries = new Map<string, GitCloneJournalEntryV1>()
  return {
    get: async (id: string) => entries.get(id) ?? null,
    list: async () => [...entries.values()],
    remove: async (id: string) => { entries.delete(id) },
    upsert: async (entry: GitCloneJournalEntryV1) => { entries.set(entry.id, entry) },
  }
}

async function waitForCondition(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error("Timed out waiting for Git integration condition.")
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
      journal: createCloneJournal(),
      pathExists,
      registry: {
        addLocal: async ({ name, localPath }) => ({ id: "clone-1", name, localPath, addedAt: new Date(0).toISOString(), lastOpenedAt: null }),
      },
    })

    const result = await service.clone({ remoteUrl: remotePath, parentDirectory, directoryName: "docs" })

    expect(result.status).toBe("registered")
    if (!result.repository) throw new Error("Clone registration failed in integration test.")
    expect(result.repository.localPath).toBe(path.join(parentDirectory, "docs"))
    await expect(git(result.repository.localPath, "rev-parse", "--show-toplevel"))
      .resolves.toContain(path.join(parentDirectory, "docs"))
  })

  it("cleans a partially written temporary clone after the real Git process is cancelled", async () => {
    const root = await createRoot()
    const source = await initializeRepository(path.join(root, "source"))
    await writeFile(path.join(source.localPath, "payload.bin"), randomBytes(64 * 1024 * 1024))
    await git(source.localPath, "add", "payload.bin")
    await git(source.localPath, "commit", "-m", "payload")
    const remotePath = path.join(root, "remote.git")
    await git(root, "clone", "--bare", source.localPath, remotePath)
    const parentDirectory = path.join(root, "clones")
    await mkdir(parentDirectory)
    const entries = new Map<string, GitCloneJournalEntryV1>()
    const journal = {
      get: async (id: string) => entries.get(id) ?? null,
      list: async () => [...entries.values()],
      remove: async (id: string) => { entries.delete(id) },
      upsert: async (entry: GitCloneJournalEntryV1) => { entries.set(entry.id, entry) },
    }
    const service = createGitCloneService({
      commandRunner: createGitClientCommandRunner(),
      journal,
      pathExists,
      registry: { addLocal: async () => { throw new Error("cancelled clone must not register") } },
    })
    const controller = new AbortController()
    const cloning = service.clone({
      remoteUrl: `file://${remotePath}`,
      parentDirectory,
      directoryName: "docs",
    }, { signal: controller.signal })
    const rejectedClone = expect(cloning).rejects.toThrow()

    await waitForCondition(async () => {
      const entry = [...entries.values()][0]
      return Boolean(entry && await pathExists(path.join(entry.tempPath, "repository", ".git", "objects")))
    })
    controller.abort()

    await rejectedClone
    expect(await pathExists(path.join(parentDirectory, "docs"))).toBe(false)
    expect(entries.size).toBe(0)
    await expect((await import("node:fs/promises")).readdir(parentDirectory)).resolves.toEqual([])
  }, 20_000)

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
    const selections = createGitChangeSelectionService({ commandRunner: runner, getSnapshot: status.getSnapshot })
    const commit = createGitCommitService({ commandRunner: runner, selections })

    const diff = await status.getDiff(repository, { path: "notes.txt" })
    const selection = await selections.prepare(repository, ["notes.txt"])
    await commit.commit(repository, { message: "complete file", selectionId: selection.selectionId })

    expect(diff.text).toContain("+working-tree")
    await expect(git(repository.localPath, "show", "HEAD:notes.txt")).resolves.toBe("working-tree\n")
  })

  it("creates the first commit through an empty temporary index", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await writeFile(path.join(repository.localPath, "README.md"), "first\n", "utf8")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const selections = createGitChangeSelectionService({ commandRunner: runner, getSnapshot: status.getSnapshot })
    const commit = createGitCommitService({ commandRunner: runner, selections })
    const selection = await selections.prepare(repository, ["README.md"])

    await commit.commit(repository, { message: "first", selectionId: selection.selectionId })

    await expect(git(repository.localPath, "show", "HEAD:README.md")).resolves.toBe("first\n")
  })

  it("rejects a commit when a selected file changes after preparation", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    const filePath = path.join(repository.localPath, "notes.txt")
    await writeFile(filePath, "base\n", "utf8")
    await git(repository.localPath, "add", "notes.txt")
    await git(repository.localPath, "commit", "-m", "base")
    await writeFile(filePath, "reviewed\n", "utf8")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const selections = createGitChangeSelectionService({ commandRunner: runner, getSnapshot: status.getSnapshot })
    const commit = createGitCommitService({ commandRunner: runner, selections })
    const selection = await selections.prepare(repository, ["notes.txt"])

    await writeFile(filePath, "changed-after-review\n", "utf8")

    await expect(commit.commit(repository, { message: "must fail", selectionId: selection.selectionId }))
      .rejects.toThrow("重新审阅")
    await expect(git(repository.localPath, "show", "HEAD:notes.txt")).resolves.toBe("base\n")
  })

  it("commits only the prepared paths and preserves unrelated staged changes", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await writeFile(path.join(repository.localPath, "selected.txt"), "base selected\n", "utf8")
    await writeFile(path.join(repository.localPath, "staged.txt"), "base staged\n", "utf8")
    await git(repository.localPath, "add", "selected.txt", "staged.txt")
    await git(repository.localPath, "commit", "-m", "base")
    await writeFile(path.join(repository.localPath, "selected.txt"), "selected update\n", "utf8")
    await writeFile(path.join(repository.localPath, "staged.txt"), "staged update\n", "utf8")
    await git(repository.localPath, "add", "staged.txt")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const selections = createGitChangeSelectionService({ commandRunner: runner, getSnapshot: status.getSnapshot })
    const commit = createGitCommitService({ commandRunner: runner, selections })
    const selection = await selections.prepare(repository, ["selected.txt"])

    await commit.commit(repository, { message: "selected only", selectionId: selection.selectionId })

    await expect(git(repository.localPath, "show", "HEAD:selected.txt")).resolves.toBe("selected update\n")
    await expect(git(repository.localPath, "show", "HEAD:staged.txt")).resolves.toBe("base staged\n")
    await expect(git(repository.localPath, "diff", "--cached", "--name-only")).resolves.toBe("staged.txt\n")
  })

  it("does not change the real index when the commit hook rejects the transaction", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await writeFile(path.join(repository.localPath, "selected.txt"), "base selected\n", "utf8")
    await writeFile(path.join(repository.localPath, "staged.txt"), "base staged\n", "utf8")
    await git(repository.localPath, "add", "selected.txt", "staged.txt")
    await git(repository.localPath, "commit", "-m", "base")
    await writeFile(path.join(repository.localPath, "selected.txt"), "selected update\n", "utf8")
    await writeFile(path.join(repository.localPath, "staged.txt"), "staged update\n", "utf8")
    await git(repository.localPath, "add", "staged.txt")
    const hookPath = path.join(repository.localPath, ".git", "hooks", "pre-commit")
    await writeFile(hookPath, "#!/bin/sh\nexit 1\n", "utf8")
    await chmod(hookPath, 0o755)
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const selections = createGitChangeSelectionService({ commandRunner: runner, getSnapshot: status.getSnapshot })
    const commit = createGitCommitService({ commandRunner: runner, selections })
    const selection = await selections.prepare(repository, ["selected.txt"])

    await expect(commit.commit(repository, { message: "rejected", selectionId: selection.selectionId })).rejects.toThrow()

    await expect(git(repository.localPath, "log", "-1", "--pretty=%s")).resolves.toBe("base\n")
    await expect(git(repository.localPath, "diff", "--cached", "--name-only")).resolves.toBe("staged.txt\n")
  })

  it("discards selected mixed changes while preserving unrelated staged files", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    for (const fileName of ["modified.txt", "deleted.txt", "old-name.txt", "unrelated.txt"]) {
      await writeFile(path.join(repository.localPath, fileName), `base ${fileName}\n`, "utf8")
    }
    await git(repository.localPath, "add", ".")
    await git(repository.localPath, "commit", "-m", "base")
    await writeFile(path.join(repository.localPath, "modified.txt"), "modified\n", "utf8")
    await rm(path.join(repository.localPath, "deleted.txt"))
    await git(repository.localPath, "mv", "old-name.txt", "new-name.txt")
    await writeFile(path.join(repository.localPath, "added.txt"), "added\n", "utf8")
    await git(repository.localPath, "add", "added.txt")
    await writeFile(path.join(repository.localPath, "untracked.txt"), "untracked\n", "utf8")
    await writeFile(path.join(repository.localPath, "unrelated.txt"), "unrelated staged\n", "utf8")
    await git(repository.localPath, "add", "unrelated.txt")
    const trashRoot = path.join(root, "trash")
    await mkdir(trashRoot)
    let trashIndex = 0
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const selections = createGitChangeSelectionService({ commandRunner: runner, getSnapshot: status.getSnapshot })
    const discard = createGitDiscardService({
      commandRunner: runner,
      selections,
      trashItem: async (targetPath) => {
        trashIndex += 1
        await (await import("node:fs/promises")).rename(targetPath, path.join(trashRoot, `${trashIndex}-${path.basename(targetPath)}`))
      },
      actor: { kind: "user" },
      auditSink: { record: () => undefined },
      permissionGuard: { check: async () => ({ allowed: true }) },
    })
    const selection = await selections.prepare(repository, [
      "modified.txt",
      "deleted.txt",
      "new-name.txt",
      "added.txt",
      "untracked.txt",
    ])

    await discard.discard(repository, { selectionId: selection.selectionId })

    await expect((await import("node:fs/promises")).readFile(path.join(repository.localPath, "modified.txt"), "utf8"))
      .resolves.toBe("base modified.txt\n")
    await expect((await import("node:fs/promises")).readFile(path.join(repository.localPath, "deleted.txt"), "utf8"))
      .resolves.toBe("base deleted.txt\n")
    await expect((await import("node:fs/promises")).readFile(path.join(repository.localPath, "old-name.txt"), "utf8"))
      .resolves.toBe("base old-name.txt\n")
    await expect(pathExists(path.join(repository.localPath, "new-name.txt"))).resolves.toBe(false)
    await expect(pathExists(path.join(repository.localPath, "added.txt"))).resolves.toBe(false)
    await expect(pathExists(path.join(repository.localPath, "untracked.txt"))).resolves.toBe(false)
    await expect(git(repository.localPath, "status", "--porcelain")).resolves.toBe("M  unrelated.txt\n")
  })

  it("keeps an untracked file when the system trash operation fails", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    const targetPath = path.join(repository.localPath, "untracked.txt")
    await writeFile(targetPath, "keep me\n", "utf8")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const selections = createGitChangeSelectionService({ commandRunner: runner, getSnapshot: status.getSnapshot })
    const selection = await selections.prepare(repository, ["untracked.txt"])
    const discard = createGitDiscardService({
      commandRunner: runner,
      selections,
      trashItem: async () => { throw new Error("trash unavailable") },
      actor: { kind: "user" },
      auditSink: { record: () => undefined },
      permissionGuard: { check: async () => ({ allowed: true }) },
    })

    await expect(discard.discard(repository, { selectionId: selection.selectionId })).rejects.toThrow("不会永久删除")
    await expect((await import("node:fs/promises")).readFile(targetPath, "utf8")).resolves.toBe("keep me\n")
  })

  it("discards a staged added file before the repository has a HEAD", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    const targetPath = path.join(repository.localPath, "first.txt")
    const trashPath = path.join(root, "trashed-first.txt")
    await writeFile(targetPath, "first\n", "utf8")
    await git(repository.localPath, "add", "first.txt")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const selections = createGitChangeSelectionService({ commandRunner: runner, getSnapshot: status.getSnapshot })
    const selection = await selections.prepare(repository, ["first.txt"])
    const discard = createGitDiscardService({
      commandRunner: runner,
      selections,
      trashItem: async (filePath) => (await import("node:fs/promises")).rename(filePath, trashPath),
      actor: { kind: "user" },
      auditSink: { record: () => undefined },
      permissionGuard: { check: async () => ({ allowed: true }) },
    })

    await discard.discard(repository, { selectionId: selection.selectionId })

    await expect(pathExists(targetPath)).resolves.toBe(false)
    await expect(pathExists(trashPath)).resolves.toBe(true)
    await expect(git(repository.localPath, "status", "--porcelain")).resolves.toBe("")
  })

  it("rejects discard when a selected tracked file changes after review", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    const targetPath = path.join(repository.localPath, "notes.txt")
    await writeFile(targetPath, "base\n", "utf8")
    await git(repository.localPath, "add", "notes.txt")
    await git(repository.localPath, "commit", "-m", "base")
    await writeFile(targetPath, "reviewed\n", "utf8")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const selections = createGitChangeSelectionService({ commandRunner: runner, getSnapshot: status.getSnapshot })
    const selection = await selections.prepare(repository, ["notes.txt"])
    const discard = createGitDiscardService({
      commandRunner: runner,
      selections,
      trashItem: async () => undefined,
      actor: { kind: "user" },
      auditSink: { record: () => undefined },
      permissionGuard: { check: async () => ({ allowed: true }) },
    })
    await writeFile(targetPath, "changed after review\n", "utf8")

    await expect(discard.discard(repository, { selectionId: selection.selectionId })).rejects.toThrow("重新审阅")
    await expect((await import("node:fs/promises")).readFile(targetPath, "utf8"))
      .resolves.toBe("changed after review\n")
  })

  it("renders an untracked file as a /dev/null-to-file diff", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await writeFile(path.join(repository.localPath, "new.txt"), "new content\n", "utf8")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })

    const diff = await status.getDiff(repository, { path: "new.txt" })

    expect(diff.binary).toBe(false)
    expect(diff.text).toContain("--- /dev/null")
    expect(diff.text).toContain("+new content")
  })

  it("does not expose unchanged repository files through the diff API", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await writeFile(path.join(repository.localPath, ".env"), "SECRET=private\n", "utf8")
    await git(repository.localPath, "add", ".env")
    await git(repository.localPath, "commit", "-m", "tracked secret")
    const status = createGitStatusService({ commandRunner: createGitClientCommandRunner(), pathExists })

    await expect(status.getDiff(repository, { path: ".env" }))
      .rejects.toThrow("当前改动")
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

  it("preserves newlines and surrounding spaces in status paths", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    const specialPath = " docs/line\nname.md "
    await mkdir(path.dirname(path.join(repository.localPath, specialPath)), { recursive: true })
    await writeFile(path.join(repository.localPath, specialPath), "content\n", "utf8")
    const status = createGitStatusService({ commandRunner: createGitClientCommandRunner(), pathExists })

    const snapshot = await status.getSnapshot(repository)

    expect(snapshot.changeCount).toBe(1)
    expect(snapshot.changesTruncated).toBe(false)
    expect(snapshot.changes[0]?.path).toBe(specialPath)
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
      getSnapshot: async () => ({ changeCount: 0, changes: [] }),
    })

    await expect(branches.list(repository)).resolves.toEqual([
      { name: "main", current: true },
      { name: "secondary", current: false },
    ])
  })

  it("lists cached branches from multiple remotes and creates a tracking checkout", async () => {
    const root = await createRoot()
    const repository = await initializeRepository(path.join(root, "repo"))
    await writeFile(path.join(repository.localPath, "README.md"), "base\n", "utf8")
    await git(repository.localPath, "add", "README.md")
    await git(repository.localPath, "commit", "-m", "base")
    const originPath = path.join(root, "origin.git")
    const upstreamPath = path.join(root, "upstream.git")
    await git(root, "clone", "--bare", repository.localPath, originPath)
    await git(root, "clone", "--bare", repository.localPath, upstreamPath)
    await git(repository.localPath, "remote", "add", "origin", originPath)
    await git(repository.localPath, "remote", "add", "upstream", upstreamPath)
    await git(repository.localPath, "push", "origin", "HEAD:refs/heads/docs/topic")
    const runner = createGitClientCommandRunner()
    const status = createGitStatusService({ commandRunner: runner, pathExists })
    const branches = createGitBranchService({ commandRunner: runner, getSnapshot: status.getSnapshot })

    await branches.fetchRemote(repository)

    await expect(branches.listRemote(repository)).resolves.toEqual([
      {
        remoteName: "origin",
        branches: [
          { name: "docs/topic", fullName: "origin/docs/topic" },
          { name: "main", fullName: "origin/main" },
        ],
      },
      {
        remoteName: "upstream",
        branches: [{ name: "main", fullName: "upstream/main" }],
      },
    ])
    await expect(branches.checkoutRemote(repository, {
      remoteName: "origin",
      branchName: "docs/topic",
      localBranchName: "docs/topic",
    })).resolves.toMatchObject({ created: true, localBranchName: "docs/topic" })
    await expect(git(repository.localPath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"))
      .resolves.toBe("origin/docs/topic\n")
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
