import { describe, expect, it, vi } from "vitest"
import type { DriveItemDto, DriveSyncBindingDto, DriveSyncSnapshotDto } from "@synapse/shared"
import { findContainedDriveBindings, getDriveItemSyncRelation, getDriveItemSyncStatus } from "../drive-item-sync"

const binding: DriveSyncBindingDto = {
  id: "binding", driveItemId: "root", driveItemName: "Docs", drivePathHint: "/Docs", kind: "folder",
  localPath: "/Users/me/Docs", status: "active", remoteCursor: null, createdAt: "", updatedAt: "", lastSyncedAt: null, lastError: null,
  excludeRules: { forced: [], defaults: ["node_modules/"], importedGitignore: [], user: ["*.log", "!keep.log"] },
}
const item = (id: string, name: string, parentId: string | null = "root", type: "file" | "folder" = "file") => ({ id, name, parentId, type }) as DriveItemDto
const path = [{ id: null, name: "根目录" }, { id: "root", name: "Docs" }]
const snapshot = (overrides: Partial<DriveSyncSnapshotDto> = {}) => ({ bindings: [binding], conflicts: [], operations: [], health: { connectivity: "online" }, ...overrides }) as DriveSyncSnapshotDto

describe("Drive item sync relationships", () => {
  it("resolves several roots and shared parents from one batch without single-item lookups", async () => {
    const second = { ...binding, id: "second", driveItemId: "other" }
    const getRemote = vi.fn(async (id: string) => item(id, "unexpected"))
    const getBatch = vi.fn(async () => ({ results: [binding, second].map((root) => ({ itemId: root.driveItemId, error: null, data: { item: item(root.driveItemId, "Root", "middle", "folder"), ancestors: [item("container", "Parent", null, "folder"), item("middle", "Middle", "container", "folder")], currentVersionId: null, etag: null } })) }))
    const result = await findContainedDriveBindings([item("container", "Parent", null, "folder")], [binding, second], [], getRemote, undefined, getBatch)
    expect(result.bindings.get("container")).toEqual(["binding", "second"])
    expect(result.failed).toBe(false)
    expect(getBatch).toHaveBeenCalledTimes(1)
    expect(getRemote).not.toHaveBeenCalled()
  })

  it("uses breadcrumb IDs, inherits nested paths and shares the engine's exclusion semantics", () => {
    expect(getDriveItemSyncRelation(item("child", "notes.md"), path, [binding])).toMatchObject({ kind: "bound", inherited: true, excluded: false, localPath: "/Users/me/Docs/notes.md" })
    expect(getDriveItemSyncRelation(item("x", "node_modules", "root", "folder"), path, [binding])).toMatchObject({ excluded: true })
    expect(getDriveItemSyncRelation(item("x", "keep.log"), path, [binding])).toMatchObject({ excluded: false })
    expect(getDriveItemSyncRelation(item("x", "a.log"), path, [binding])).toMatchObject({ excluded: true })
    expect(getDriveItemSyncRelation(item("x", "a"), [{ id: "different", name: "Docs" }], [binding])).toBeNull()
    expect(getDriveItemSyncRelation(item("x", "../escape"), path, [binding])).toMatchObject({ kind: "unknown" })
  })

  it("keeps successful ancestry when another batch root fails without individual retries", async () => {
    const getRemote = vi.fn(async (id: string) => item(id, "unexpected"))
    const getBatch = vi.fn(async () => ({ results: [
      { itemId: "root", error: null, data: { item: item("root", "Root", "container", "folder"), ancestors: [item("container", "Parent", null, "folder")], currentVersionId: null, etag: null } },
      { itemId: "failed", data: null, error: { status: 429, code: "THROTTLED", message: "wait" } },
    ] }))
    const result = await findContainedDriveBindings([item("container", "Parent", null, "folder")], [binding, { ...binding, id: "failed", driveItemId: "failed" }], [], getRemote, undefined, getBatch)
    expect(result.bindings.get("container")).toEqual(["binding"])
    expect(result.failed).toBe(true)
    expect(getRemote).not.toHaveBeenCalled()
  })

  it("ignores a deleted binding root when finding other folders' sync relationships", async () => {
    const getBatch = vi.fn(async () => ({ results: [
      { itemId: "root", error: null, data: { item: item("root", "Root", "container", "folder"), ancestors: [item("container", "Parent", null, "folder")], currentVersionId: null, etag: null } },
      { itemId: "deleted", data: null, error: { status: 404, code: "NOT_FOUND", message: "missing" } },
    ] }))
    const result = await findContainedDriveBindings(
      [item("container", "Parent", null, "folder"), item("other", "Other", null, "folder")],
      [binding, { ...binding, id: "deleted", driveItemId: "deleted" }], [], vi.fn(), undefined, getBatch,
    )
    expect(result.bindings.get("container")).toEqual(["binding"])
    expect(result.bindings.has("other")).toBe(false)
    expect(result.failed).toBe(false)
  })

  it("still reports an unconfirmed ancestor or a batch-level failure as unknown", async () => {
    const folders = [item("container", "Parent", null, "folder")]
    const incomplete = vi.fn(async () => ({ results: [{ itemId: "root", data: null, error: { status: 409, code: "ANCESTRY_INCOMPLETE", message: "missing parent" } }] }))
    expect((await findContainedDriveBindings(folders, [binding], [], vi.fn(), undefined, incomplete)).failed).toBe(true)
    const batchFailure = vi.fn(async () => { throw Object.assign(new Error("HTTP 404"), { status: 404 }) })
    expect((await findContainedDriveBindings(folders, [binding], [], vi.fn(), undefined, batchFailure)).failed).toBe(true)
  })

  it("only ignores a direct missing root in the single-item fallback", async () => {
    const folders = [item("container", "Parent", null, "folder")]
    const missing = Object.assign(new Error("HTTP 404"), { status: 404 })
    const rootMissing = await findContainedDriveBindings(folders, [binding], [], async () => { throw missing })
    expect(rootMissing.failed).toBe(false)
    const parentMissing = await findContainedDriveBindings(folders, [binding], [], async (id) => {
      if (id === "root") return item("root", "Root", "missing-parent", "folder")
      throw missing
    })
    expect(parentMissing.failed).toBe(true)
  })

  it("limits conflict and progress states to the item's actual subtree", () => {
    const relation = getDriveItemSyncRelation(item("child", "notes.md"), path, [{ ...binding, status: "conflict" }])!
    const state = snapshot({ conflicts: [{ id: "conflict", bindingId: binding.id, relativePath: "other.md", type: "both_modified", availableActions: [], localSummary: null, remoteSummary: null, createdAt: "" }] })
    expect(getDriveItemSyncStatus(relation, state).label).toBe("同步")
    expect(getDriveItemSyncStatus(relation, { ...state, conflicts: [{ ...state.conflicts[0], relativePath: "notes.md" }] }).label).toBe("同步有冲突")
    expect(getDriveItemSyncStatus(relation, snapshot({ health: { ...state.health, connectivity: "offline" } })).label).toBe("同步离线")
  })

  it("preserves independent file roots, Windows paths and forced excludes", () => {
    const direct = { ...binding, kind: "file" as const, driveItemId: "file", localPath: "C:\\Docs\\file.md" }
    expect(getDriveItemSyncRelation(item("file", "renamed.md"), [], [direct])).toMatchObject({ inherited: false, localPath: direct.localPath })
    expect(getDriveItemSyncRelation(item("child", "notes.md"), path, [{ ...binding, localPath: "C:\\Docs" }])).toMatchObject({ localPath: "C:\\Docs\\notes.md" })
    expect(getDriveItemSyncRelation(item("git", ".git", "root", "folder"), path, [binding])).toMatchObject({ excluded: true })
    expect(getDriveItemSyncRelation(item("child", "notes.md"), path, [{ ...binding, status: "removed" }])).toBeNull()
  })

  it("keeps pause and root-level conflicts meaningful for inherited items", () => {
    const child = item("child", "notes.md")
    const paused = getDriveItemSyncRelation(child, path, [{ ...binding, status: "paused" }])!
    expect(getDriveItemSyncStatus(paused, snapshot()).label).toBe("同步已暂停")
    const inherited = getDriveItemSyncRelation(child, path, [binding])!
    const conflicts = [{ id: "root-conflict", bindingId: binding.id, relativePath: "", type: "type_changed", availableActions: [], localSummary: null, remoteSummary: null, createdAt: "" }]
    expect(getDriveItemSyncStatus(inherited, snapshot({ conflicts })).label).toBe("同步有冲突")
    expect(getDriveItemSyncStatus({ kind: "contains", bindings: [binding], incomplete: true }, snapshot()).detail).toContain("尚未确认")
  })

  it("finds contained bindings by ancestry, never by matching names or path hints", async () => {
    const getRemote = vi.fn(async (id: string) => id === "root" ? item("root", "Docs", "container", "folder") : item(id, "other", null, "folder"))
    const result = await findContainedDriveBindings([item("container", "Parent", null, "folder"), item("unrelated", "Docs", null, "folder")], [binding], [], getRemote)
    expect(result.bindings.get("container")).toEqual(["binding"])
    expect(result.bindings.has("unrelated")).toBe(false)
    expect(result.failed).toBe(false)
  })

  it("reports ancestry failures and cycles as unknown instead of claiming no relationship", async () => {
    const folders = [item("container", "Parent", null, "folder")]
    const rejected = await findContainedDriveBindings(folders, [binding], [], async () => { throw new Error("offline") })
    expect(rejected.failed).toBe(true)
    const cycle = await findContainedDriveBindings(folders, [binding], [], async (id) => item(id, "cycle", id, "folder"))
    expect(cycle.failed).toBe(true)
  })
})
