import { describe, expect, it, vi } from "vitest"
import type { SynapseGitFileChange } from "../../../../src/types/git"
import { createGitDiscardService } from "../git-discard-service"

const repository = {
  id: "repo-1",
  name: "Docs",
  localPath: "/repo",
  addedAt: "2026-06-17T10:00:00.000Z",
  lastOpenedAt: null,
}

const changes: SynapseGitFileChange[] = [
  { path: "modified.md", originalPath: null, status: "modified", staged: true, conflicted: false },
  { path: "deleted.md", originalPath: null, status: "deleted", staged: false, conflicted: false },
  { path: "new-name.md", originalPath: "old-name.md", status: "renamed", staged: true, conflicted: false },
  { path: "added.md", originalPath: null, status: "added", staged: true, conflicted: false },
  { path: "untracked.md", originalPath: null, status: "untracked", staged: false, conflicted: false },
]

function createFixture(overrides: { readonly trashItem?: (targetPath: string) => Promise<void> } = {}) {
  const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "" })
  const selections = {
    invalidate: vi.fn(),
    validate: vi.fn().mockResolvedValue({
      selectionId: "selection-1",
      repositoryId: "repo-1",
      repositoryPath: "/repo",
      expiresAtMs: Date.now() + 60_000,
      head: "head-1",
      changes,
      paths: ["modified.md", "deleted.md", "old-name.md", "new-name.md", "added.md", "untracked.md"],
      fingerprints: new Map(),
    }),
  }
  const trashItem = vi.fn(overrides.trashItem ?? (async () => undefined))
  const auditSink = { record: vi.fn() }
  const permissionGuard = { check: vi.fn().mockResolvedValue({ allowed: true }) }
  const service = createGitDiscardService({
    commandRunner: { run },
    selections,
    trashItem,
    actor: { kind: "user" },
    auditSink,
    permissionGuard,
    now: () => new Date("2026-08-02T10:00:00.000Z"),
  })
  return { auditSink, permissionGuard, run, selections, service, trashItem }
}

describe("git discard service", () => {
  it("restores tracked paths and trashes only selected new paths", async () => {
    const fixture = createFixture()

    await expect(fixture.service.discard(repository, { selectionId: "selection-1" })).resolves.toEqual({
      completedAt: "2026-08-02T10:00:00.000Z",
      discardedCount: 5,
      restoredPaths: ["modified.md", "deleted.md", "old-name.md"],
      trashedPaths: ["new-name.md", "added.md", "untracked.md"],
    })

    expect(fixture.selections.validate).toHaveBeenCalledTimes(2)
    expect(fixture.trashItem.mock.calls.map(([targetPath]) => targetPath)).toEqual([
      "/repo/new-name.md",
      "/repo/added.md",
      "/repo/untracked.md",
    ])
    expect(fixture.run).toHaveBeenCalledWith(expect.objectContaining({
      args: ["--literal-pathspecs", "reset", "--mixed", "HEAD", "--", "new-name.md", "added.md"],
    }))
    expect(fixture.run).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        "--literal-pathspecs",
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        "modified.md",
        "deleted.md",
        "old-name.md",
      ],
    }))
    expect(fixture.selections.invalidate).toHaveBeenCalledWith("selection-1")
  })

  it("does not permanently delete a file when moving it to trash fails", async () => {
    const fixture = createFixture({ trashItem: async () => { throw new Error("trash unavailable") } })

    await expect(fixture.service.discard(repository, { selectionId: "selection-1" }))
      .rejects.toThrow("不会永久删除")

    expect(fixture.trashItem).toHaveBeenCalled()
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.selections.invalidate).toHaveBeenCalledWith("selection-1")
    expect(fixture.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }))
  })

  it("checks trash permissions before mutating Git or the working tree", async () => {
    const fixture = createFixture()
    fixture.permissionGuard.check.mockResolvedValue({ allowed: false, reason: "denied", policyId: "test" })

    await expect(fixture.service.discard(repository, { selectionId: "selection-1" }))
      .rejects.toThrow("权限")

    expect(fixture.trashItem).not.toHaveBeenCalled()
    expect(fixture.run).not.toHaveBeenCalled()
    expect(fixture.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
  })

  it("rejects conflicted selections without changing files", async () => {
    const fixture = createFixture()
    fixture.selections.validate.mockResolvedValue({
      ...(await fixture.selections.validate()),
      changes: [{ path: "conflict.md", originalPath: null, status: "conflicted", staged: false, conflicted: true }],
    })
    fixture.selections.validate.mockClear()

    await expect(fixture.service.discard(repository, { selectionId: "selection-1" }))
      .rejects.toThrow("外部处理")

    expect(fixture.trashItem).not.toHaveBeenCalled()
    expect(fixture.run).not.toHaveBeenCalled()
  })
})
