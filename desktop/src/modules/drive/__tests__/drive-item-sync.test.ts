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
  it("uses breadcrumb IDs, inherits nested paths and shares the engine's exclusion semantics", () => {
    expect(getDriveItemSyncRelation(item("child", "notes.md"), path, [binding])).toMatchObject({ kind: "bound", inherited: true, excluded: false, localPath: "/Users/me/Docs/notes.md" })
    expect(getDriveItemSyncRelation(item("x", "node_modules", "root", "folder"), path, [binding])).toMatchObject({ excluded: true })
    expect(getDriveItemSyncRelation(item("x", "keep.log"), path, [binding])).toMatchObject({ excluded: false })
    expect(getDriveItemSyncRelation(item("x", "a.log"), path, [binding])).toMatchObject({ excluded: true })
    expect(getDriveItemSyncRelation(item("x", "a"), [{ id: "different", name: "Docs" }], [binding])).toBeNull()
    expect(getDriveItemSyncRelation(item("x", "../escape"), path, [binding])).toMatchObject({ kind: "unknown" })
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
