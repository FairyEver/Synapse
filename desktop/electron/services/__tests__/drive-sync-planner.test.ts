import { describe, expect, it } from "vitest"
import type { DriveChangeDto } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveSyncBaselineEntryV1, DriveSyncBindingEntryV1 } from "../../runtime/data-repo"
import {
  planDriveSyncLocalChanges,
  planDriveSyncRemoteChanges,
  type DriveSyncLocalChange,
} from "../drive-sync-planner"
import { createDefaultDriveSyncExcludeRules } from "../drive-sync-excludes"

describe("drive sync planner", () => {
  it("plans local creates and modifications as uploads", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [baseline({ relativePath: "existing.md", remoteItemId: "remote-existing", localHash: "sha256:before" })],
      changes: [
        localChange({ relativePath: "new.md", kind: "created" }),
        localChange({ relativePath: "existing.md", kind: "modified" }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({ kind: "upload", relativePath: "existing.md", driveItemId: "remote-existing" }),
      expect.objectContaining({ kind: "upload", relativePath: "new.md", driveItemId: null }),
    ])
  })

  it("plans local deletes as remote trash operations", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [baseline({ relativePath: "gone.md", remoteItemId: "remote-gone" })],
      changes: [localChange({ relativePath: "gone.md", kind: "deleted", localKind: "missing" })],
    })

    expect(result.operations).toEqual([
      expect.objectContaining({ kind: "delete_remote", relativePath: "gone.md", driveItemId: "remote-gone" }),
    ])
  })

  it("does not plan folder binding root changes as child operations", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [baseline({ relativePath: "", remoteItemId: "remote-root", kind: "folder", localHash: null })],
      changes: [
        localChange({ relativePath: "", kind: "modified", localKind: "folder", localHash: null }),
      ],
    })

    expect(result.operations).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it("does not re-upload already synced folders for local directory events", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [
        baseline({ relativePath: "Project", remoteItemId: "remote-project", kind: "folder", localHash: null }),
      ],
      changes: [
        localChange({ relativePath: "Project", kind: "modified", localKind: "folder", localHash: null }),
      ],
    })

    expect(result.operations).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it("plans local file renames as remote moves when the hash is unchanged", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [baseline({ relativePath: "old.md", remoteItemId: "remote-old", localHash: "sha256:same" })],
      changes: [
        localChange({ relativePath: "new.md", kind: "created", localHash: "sha256:same" }),
        localChange({ relativePath: "old.md", kind: "deleted", localKind: "missing" }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({ kind: "move_remote", relativePath: "new.md", driveItemId: "remote-old" }),
    ])
  })

  it("plans local folder renames as one remote folder move when the subtree is unchanged", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [
        baseline({ relativePath: "old", remoteItemId: "remote-folder", kind: "folder", localHash: null }),
        baseline({ relativePath: "old/spec.md", remoteItemId: "remote-spec", localHash: "sha256:same" }),
      ],
      changes: [
        localChange({ relativePath: "new", kind: "created", localKind: "folder", localHash: null }),
        localChange({ relativePath: "new/spec.md", kind: "created", localHash: "sha256:same" }),
        localChange({ relativePath: "old", kind: "deleted", localKind: "missing" }),
        localChange({ relativePath: "old/spec.md", kind: "deleted", localKind: "missing" }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({ kind: "move_remote", relativePath: "new", driveItemId: "remote-folder" }),
    ])
  })

  it("turns simultaneous local and remote modifications into conflicts", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [baseline({ relativePath: "spec.md", remoteItemId: "remote-spec" })],
      remoteChangedPaths: new Set(["spec.md"]),
      changes: [localChange({ relativePath: "spec.md", kind: "modified" })],
    })

    expect(result.operations).toEqual([])
    expect(result.conflicts).toEqual([
      expect.objectContaining({ type: "both_modified", relativePath: "spec.md", driveItemId: "remote-spec" }),
    ])
  })

  it("turns local delete versus remote update into conflicts", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [baseline({ relativePath: "spec.md", remoteItemId: "remote-spec" })],
      remoteChangedPaths: new Set(["spec.md"]),
      changes: [localChange({ relativePath: "spec.md", kind: "deleted", localKind: "missing" })],
    })

    expect(result.conflicts).toEqual([
      expect.objectContaining({ type: "delete_vs_modify", relativePath: "spec.md" }),
    ])
  })

  it("turns local parent deletes versus remote child updates into conflicts", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [
        baseline({ relativePath: "Project", remoteItemId: "remote-project", kind: "folder", localHash: null }),
        baseline({ relativePath: "Project/draft.md", remoteItemId: "remote-draft" }),
      ],
      remoteChangedPaths: new Set(["Project/draft.md"]),
      changes: [localChange({ relativePath: "Project", kind: "deleted", localKind: "missing" })],
    })

    expect(result.operations).toEqual([])
    expect(result.conflicts).toEqual([
      expect.objectContaining({ type: "delete_vs_modify", relativePath: "Project", driveItemId: "remote-project" }),
    ])
  })

  it("turns local file/folder mismatches into conflicts", () => {
    const result = planDriveSyncLocalChanges({
      binding: binding(),
      baseline: [baseline({ relativePath: "spec.md", remoteItemId: "remote-spec", kind: "file" })],
      changes: [localChange({ relativePath: "spec.md", kind: "modified", localKind: "folder" })],
    })

    expect(result.conflicts).toEqual([
      expect.objectContaining({ type: "type_mismatch", relativePath: "spec.md" }),
    ])
  })

  it("plans remote changes as local operations", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [baseline({ relativePath: "old.md", remoteItemId: "remote-old" })],
      changes: [
        remoteChange({ itemId: "remote-old", type: "content_updated", pathHint: "/Docs/old.md" }),
        remoteChange({ itemId: "remote-new", type: "created", pathHint: "/Docs/new.md" }),
        remoteChange({ itemId: "remote-trash", type: "trashed", pathHint: "/Docs/trash.md" }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({ kind: "download", relativePath: "new.md", driveItemId: "remote-new" }),
      expect.objectContaining({ kind: "download", relativePath: "old.md", driveItemId: "remote-old" }),
      expect.objectContaining({ kind: "delete_local", relativePath: "trash.md", driveItemId: "remote-trash" }),
    ])
  })

  it("turns remote parent deletes versus local child updates into conflicts", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [
        baseline({ relativePath: "Project", remoteItemId: "remote-project", kind: "folder", localHash: null }),
        baseline({ relativePath: "Project/draft.md", remoteItemId: "remote-draft" }),
      ],
      localChangedPaths: new Set(["Project/draft.md"]),
      changes: [
        remoteChange({ itemId: "remote-project", type: "trashed", pathHint: "/Docs/Project", itemKind: "folder" }),
      ],
    })

    expect(result.operations).toEqual([])
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        type: "delete_vs_modify",
        relativePath: "Project",
        localPath: "/Users/me/Docs/Project",
        driveItemId: "remote-project",
      }),
    ])
  })

  it("turns remote parent renames versus local child updates into conflicts", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [
        baseline({ relativePath: "Project", remoteItemId: "remote-project", kind: "folder", localHash: null }),
        baseline({ relativePath: "Project/draft.md", remoteItemId: "remote-draft" }),
      ],
      localChangedPaths: new Set(["Project/draft.md"]),
      changes: [
        remoteChange({ itemId: "remote-project", type: "renamed", pathHint: "/Docs/Archive", itemKind: "folder" }),
      ],
    })

    expect(result.operations).toEqual([])
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        type: "both_modified",
        relativePath: "Project",
        localPath: "/Users/me/Docs/Project",
        remotePathHint: "/Docs/Archive",
        driveItemId: "remote-project",
      }),
    ])
  })

  it("uses remote rename and move paths instead of stale baseline paths", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [baseline({ relativePath: "old.md", remoteItemId: "remote-old" })],
      changes: [
        remoteChange({ itemId: "remote-old", type: "renamed", pathHint: "/Docs/new.md" }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: "move_local",
        relativePath: "new.md",
        localPath: "/Users/me/Docs/new.md",
        driveItemId: "remote-old",
      }),
    ])
  })

  it("uses current moved-in paths when the change keeps the previous path hint", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [],
      changes: [
        remoteChange({
          itemId: "remote-report",
          type: "moved",
          pathHint: "/Archive/report.md",
          currentPathHint: "/Docs/Nested/report.md",
        }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: "move_local",
        relativePath: "Nested/report.md",
        localPath: "/Users/me/Docs/Nested/report.md",
        driveItemId: "remote-report",
        remotePathHint: "/Docs/Nested/report.md",
      }),
    ])
  })

  it("deletes local copies when remote items move outside the synced root", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [baseline({ relativePath: "report.md", remoteItemId: "remote-report" })],
      changes: [
        remoteChange({
          itemId: "remote-report",
          type: "moved",
          pathHint: "/Docs/report.md",
          currentPathHint: "/Archive/report.md",
        }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: "delete_local",
        relativePath: "report.md",
        localPath: "/Users/me/Docs/report.md",
        driveItemId: "remote-report",
      }),
    ])
  })

  it("uses the new remote path for later updates in the same change page", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [baseline({ relativePath: "z.md", remoteItemId: "remote-file" })],
      changes: [
        remoteChange({ itemId: "remote-file", type: "renamed", pathHint: "/Docs/a.md" }),
        remoteChange({ itemId: "remote-file", type: "content_updated", pathHint: "/Docs/a.md" }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: "move_local",
        relativePath: "a.md",
        localPath: "/Users/me/Docs/a.md",
        driveItemId: "remote-file",
      }),
      expect.objectContaining({
        kind: "download",
        relativePath: "a.md",
        localPath: "/Users/me/Docs/a.md",
        driveItemId: "remote-file",
      }),
    ])
  })

  it("keeps nested remote paths and item kinds from change metadata", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [],
      changes: [
        remoteChange({ itemId: "remote-folder", type: "created", pathHint: "/Docs/notes", itemKind: "folder" }),
        remoteChange({ itemId: "remote-file", type: "created", pathHint: "/Docs/notes/spec.md", itemKind: "file" }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: "download",
        relativePath: "notes",
        driveItemId: "remote-folder",
        remoteItemKind: "folder",
      }),
      expect.objectContaining({
        kind: "download",
        relativePath: "notes/spec.md",
        driveItemId: "remote-file",
        remoteItemKind: "file",
      }),
    ])
  })

  it("collapses restored folder descendants into one folder download", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [],
      changes: [
        remoteChange({ itemId: "remote-folder", type: "restored", pathHint: "/Docs/Project", itemKind: "folder" }),
        remoteChange({ itemId: "remote-spec", type: "restored", pathHint: "/Docs/Project/spec.md", itemKind: "file" }),
        remoteChange({ itemId: "remote-assets", type: "restored", pathHint: "/Docs/Project/assets", itemKind: "folder" }),
        remoteChange({ itemId: "remote-logo", type: "restored", pathHint: "/Docs/Project/assets/logo.png", itemKind: "file" }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: "download",
        relativePath: "Project",
        driveItemId: "remote-folder",
        remoteItemKind: "folder",
      }),
    ])
  })

  it("ignores remote changes outside the binding path and excluded paths", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [],
      changes: [
        remoteChange({ itemId: "remote-outside", type: "created", pathHint: "/Other/a.md" }),
        remoteChange({ itemId: "remote-git", type: "created", pathHint: "/Docs/.git/config" }),
      ],
    })

    expect(result.operations).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it("ignores unscoped remote changes without baseline or path hints", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [],
      changes: [
        remoteChange({ itemId: "remote-outside", type: "trashed", pathHint: null, name: "notes.md" }),
        remoteChange({ itemId: "remote-update", type: "content_updated", pathHint: null, name: "spec.md" }),
      ],
    })

    expect(result.operations).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it("uses the existing baseline for remote changes without path hints", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({ drivePathHint: "/Docs" }),
      baseline: [baseline({ relativePath: "notes.md", remoteItemId: "remote-notes" })],
      changes: [
        remoteChange({ itemId: "remote-notes", type: "trashed", pathHint: null, name: "notes.md" }),
      ],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({ kind: "delete_local", relativePath: "notes.md", driveItemId: "remote-notes" }),
    ])
  })

  it("ignores unrelated account-wide changes for file bindings", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({
        driveItemId: "remote-file",
        driveItemName: "bb-file-alpha.md",
        kind: "file",
        drivePathHint: "/bb-file-alpha.md",
        localPath: "/Users/me/bb-file-alpha.md",
      }),
      baseline: [baseline({ relativePath: "", remoteItemId: "remote-file" })],
      changes: [
        remoteChange({ itemId: "remote-created", type: "created", pathHint: "/bb-file-alpha.md/root.md" }),
        remoteChange({ itemId: "remote-trashed", type: "trashed", pathHint: "/bb-file-alpha.md/nested.md" }),
        remoteChange({ itemId: "remote-updated", type: "content_updated", pathHint: "/Other/root.md" }),
      ],
    })

    expect(result.operations).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it("plans file binding remote deletes against the bound local file", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        drivePathHint: "/spec.md",
        localPath: "/Users/me/spec.md",
      }),
      baseline: [baseline({ relativePath: "", remoteItemId: "remote-file" })],
      changes: [remoteChange({ itemId: "remote-file", type: "trashed", pathHint: "/spec.md" })],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: "delete_local",
        relativePath: "",
        localPath: "/Users/me/spec.md",
        driveItemId: "remote-file",
      }),
    ])
  })

  it("plans file binding remote content updates as root downloads", () => {
    const result = planDriveSyncRemoteChanges({
      binding: binding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        drivePathHint: "/spec.md",
        localPath: "/Users/me/spec.md",
      }),
      baseline: [baseline({ relativePath: "", remoteItemId: "remote-file" })],
      changes: [remoteChange({ itemId: "remote-file", type: "content_updated", pathHint: "/spec.md" })],
    })

    expect(result.conflicts).toEqual([])
    expect(result.operations).toEqual([
      expect.objectContaining({
        kind: "download",
        relativePath: "",
        localPath: "/Users/me/spec.md",
        driveItemId: "remote-file",
      }),
    ])
  })
})

function binding(input: Partial<DriveSyncBindingEntryV1> = {}): DriveSyncBindingEntryV1 {
  return {
    id: "binding-1",
    schemaVersion: 1,
    driveItemId: "drive-root",
    driveItemName: "Docs",
    kind: "folder",
    drivePathHint: "/Docs",
    localPath: "/Users/me/Docs",
    status: "active",
    remoteCursor: "41",
    lastSyncedAt: null,
    lastError: null,
    excludeRules: createDefaultDriveSyncExcludeRules(),
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    ...input,
  }
}

function baseline(input: Partial<DriveSyncBaselineEntryV1> & {
  readonly relativePath: string
  readonly remoteItemId: string
}): DriveSyncBaselineEntryV1 {
  return {
    id: `binding-1:${input.relativePath}`,
    schemaVersion: 1,
    bindingId: "binding-1",
    relativePath: input.relativePath,
    kind: input.kind ?? "file",
    remoteItemId: input.remoteItemId,
    remoteVersionId: null,
    remoteEtag: null,
    localSize: null,
    localMtimeMs: null,
    localHash: input.localHash ?? "sha256:same",
    lastSyncedAt: "2026-06-28T00:00:00.000Z",
    deletedAt: null,
  }
}

function localChange(input: Partial<DriveSyncLocalChange> & {
  readonly relativePath: string
  readonly kind: DriveSyncLocalChange["kind"]
}): DriveSyncLocalChange {
  return {
    bindingId: "binding-1",
    relativePath: input.relativePath,
    kind: input.kind,
    localPath: `/Users/me/Docs/${input.relativePath}`,
    localKind: input.localKind ?? "file",
    localSize: input.localSize,
    localMtimeMs: input.localMtimeMs,
    localHash: input.localHash,
  }
}

function remoteChange(input: Pick<DriveChangeDto, "itemId" | "type"> & {
  readonly pathHint: string | null
  readonly currentPathHint?: string | null
  readonly name?: string | null
  readonly itemKind?: DriveChangeDto["itemKind"]
}): DriveChangeDto {
  return {
    id: `change:${input.itemId}`,
    sequence: "42",
    itemId: input.itemId,
    parentId: null,
    type: input.type,
    versionId: null,
    etag: null,
    name: input.name ?? input.pathHint?.split("/").at(-1) ?? null,
    pathHint: input.pathHint,
    currentPathHint: input.currentPathHint,
    itemKind: input.itemKind ?? null,
    actor: "user",
    occurredAt: "2026-06-28T00:00:00.000Z",
  }
}
