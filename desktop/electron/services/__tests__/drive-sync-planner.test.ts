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
  }
}

function remoteChange(input: Pick<DriveChangeDto, "itemId" | "type" | "pathHint">): DriveChangeDto {
  return {
    id: `change:${input.itemId}`,
    sequence: "42",
    itemId: input.itemId,
    parentId: null,
    type: input.type,
    versionId: null,
    etag: null,
    name: input.pathHint.split("/").at(-1) ?? null,
    pathHint: input.pathHint,
    actor: "user",
    occurredAt: "2026-06-28T00:00:00.000Z",
  }
}
