import { describe, expect, it, vi } from "vitest"
import type { SynapseGitFileChange } from "../../../../src/types/git"
import { createGitChangeSelectionService } from "../git-change-selection-service"

const repository = {
  id: "repo-1",
  name: "Docs",
  localPath: "/repo",
  addedAt: "2026-06-17T10:00:00.000Z",
  lastOpenedAt: null,
}

const modifiedChange: SynapseGitFileChange = {
  path: "docs/a.md",
  originalPath: null,
  status: "modified",
  staged: false,
  conflicted: false,
}

describe("git change selection service", () => {
  it("binds a selection to canonical status and both rename paths", async () => {
    const change: SynapseGitFileChange = {
      ...modifiedChange,
      path: "docs/new.md",
      originalPath: "docs/old.md",
      status: "renamed",
    }
    const fingerprintPath = vi.fn().mockResolvedValue("fingerprint")
    const service = createGitChangeSelectionService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "head-1", stderr: "" }) },
      fingerprintPath,
      getSnapshot: vi.fn().mockResolvedValue({ changes: [change] }),
      now: () => new Date("2026-06-17T10:00:00.000Z"),
      randomId: () => "selection-1",
    })

    await expect(service.prepare(repository, ["docs/new.md"])).resolves.toEqual({
      selectionId: "selection-1",
      repositoryId: "repo-1",
      expiresAt: "2026-06-17T10:15:00.000Z",
      changes: [change],
    })
    expect(fingerprintPath).toHaveBeenCalledWith("/repo/docs/old.md")
    expect(fingerprintPath).toHaveBeenCalledWith("/repo/docs/new.md")
  })

  it("invalidates a selection when content changes without a status change", async () => {
    let fingerprint = "reviewed"
    const service = createGitChangeSelectionService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "head-1", stderr: "" }) },
      fingerprintPath: vi.fn(async () => fingerprint),
      getSnapshot: vi.fn().mockResolvedValue({ changes: [modifiedChange] }),
      randomId: () => "selection-1",
    })
    const selection = await service.prepare(repository, ["docs/a.md"])
    fingerprint = "changed"

    await expect(service.validate(repository, selection.selectionId)).rejects.toThrow("重新审阅")
    await expect(service.validate(repository, selection.selectionId)).rejects.toThrow("已过期")
  })

  it("rejects expired and cross-repository selections", async () => {
    let timestamp = Date.parse("2026-06-17T10:00:00.000Z")
    const service = createGitChangeSelectionService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "head-1", stderr: "" }) },
      fingerprintPath: vi.fn().mockResolvedValue("reviewed"),
      getSnapshot: vi.fn().mockResolvedValue({ changes: [modifiedChange] }),
      now: () => new Date(timestamp),
      randomId: vi.fn()
        .mockReturnValueOnce("selection-expired")
        .mockReturnValueOnce("selection-cross-repo"),
    })
    const expired = await service.prepare(repository, ["docs/a.md"])
    timestamp += 15 * 60 * 1_000
    await expect(service.validate(repository, expired.selectionId)).rejects.toThrow("已过期")

    timestamp += 1
    const crossRepository = await service.prepare(repository, ["docs/a.md"])
    await expect(service.validate({ ...repository, id: "repo-2" }, crossRepository.selectionId))
      .rejects.toThrow("不属于当前仓库")
  })

  it("keeps only the most recent selections for each repository", async () => {
    let id = 0
    const service = createGitChangeSelectionService({
      commandRunner: { run: vi.fn().mockResolvedValue({ stdout: "head-1", stderr: "" }) },
      fingerprintPath: vi.fn().mockResolvedValue("reviewed"),
      getSnapshot: vi.fn().mockResolvedValue({ changes: [modifiedChange] }),
      randomId: () => `selection-${++id}`,
    })
    const prepared = []
    for (let index = 0; index < 33; index += 1) {
      prepared.push(await service.prepare(repository, ["docs/a.md"]))
    }

    await expect(service.validate(repository, prepared[0]!.selectionId)).rejects.toThrow("已过期")
    await expect(service.validate(repository, prepared.at(-1)!.selectionId)).resolves.toMatchObject({
      selectionId: "selection-33",
    })
  })
})
