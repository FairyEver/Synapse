import { describe, expect, it, vi } from "vitest"
import type { DriveChangeDto, DriveChangeListPageDto } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveSyncBaselineEntryV1, DriveSyncBindingEntryV1 } from "../../runtime/data-repo"
import { createDefaultDriveSyncExcludeRules } from "../drive-sync-excludes"
import { pollDriveSyncRemoteChanges } from "../drive-sync-remote-poller"

describe("drive sync remote poller", () => {
  it("pulls remote pages from the binding cursor and advances the cursor", async () => {
    const accountService = createAccountService([
      page({
        items: [
          remoteChange({ itemId: "remote-spec", type: "content_updated", pathHint: "/Docs/spec.md" }),
          remoteChange({ itemId: "remote-new", type: "created", pathHint: "/Docs/new.md", sequence: "43" }),
        ],
        nextCursor: "43",
      }),
    ])
    const operations: unknown[] = []
    const updateCursor = vi.fn()

    await pollDriveSyncRemoteChanges({
      binding: binding({ remoteCursor: "41" }),
      baseline: [baseline({ relativePath: "spec.md", remoteItemId: "remote-spec" })],
      accountService,
      onOperations: async (items) => { operations.push(...items) },
      onConflicts: async () => undefined,
      updateBindingCursor: updateCursor,
    })

    expect(accountService.listDriveChanges).toHaveBeenCalledWith({
      cursor: "41",
      limit: 100,
      rootItemId: "drive-root",
      rootPathHint: "/Docs",
    })
    expect(operations).toEqual([
      expect.objectContaining({ kind: "download", relativePath: "new.md", driveItemId: "remote-new" }),
      expect.objectContaining({ kind: "download", relativePath: "spec.md", driveItemId: "remote-spec" }),
    ])
    expect(updateCursor).toHaveBeenCalledWith("binding-1", "43")
  })

  it("continues through paginated remote changes", async () => {
    const accountService = createAccountService([
      page({ items: [remoteChange({ itemId: "remote-a", type: "created", pathHint: "/Docs/a.md" })], nextCursor: "42", hasMore: true }),
      page({ items: [remoteChange({ itemId: "remote-b", type: "created", pathHint: "/Docs/b.md", sequence: "43" })], nextCursor: "43" }),
    ])
    const operations: unknown[] = []

    await pollDriveSyncRemoteChanges({
      binding: binding({ remoteCursor: "41" }),
      baseline: [],
      accountService,
      onOperations: async (items) => { operations.push(...items) },
      onConflicts: async () => undefined,
      updateBindingCursor: async () => undefined,
    })

    expect(accountService.listDriveChanges).toHaveBeenNthCalledWith(1, {
      cursor: "41",
      limit: 100,
      rootItemId: "drive-root",
      rootPathHint: "/Docs",
    })
    expect(accountService.listDriveChanges).toHaveBeenNthCalledWith(2, {
      cursor: "42",
      limit: 100,
      rootItemId: "drive-root",
      rootPathHint: "/Docs",
    })
    expect(operations).toHaveLength(2)
  })

  it("uses updated child paths when later pages change the same remote item", async () => {
    const accountService = createAccountService([
      page({
        items: [remoteChange({ id: "change:move", itemId: "remote-spec", type: "renamed", pathHint: "/Docs/new.md" })],
        nextCursor: "42",
        hasMore: true,
      }),
      page({
        items: [remoteChange({ id: "change:update", itemId: "remote-spec", type: "content_updated", pathHint: "/Docs/new.md", sequence: "43" })],
        nextCursor: "43",
      }),
    ])
    const operations: unknown[] = []

    await pollDriveSyncRemoteChanges({
      binding: binding({ remoteCursor: "41" }),
      baseline: [baseline({ relativePath: "old.md", remoteItemId: "remote-spec" })],
      accountService,
      onOperations: async (items) => { operations.push(...items) },
      onConflicts: async () => undefined,
      updateBindingCursor: async () => undefined,
    })

    expect(operations).toEqual([
      expect.objectContaining({ kind: "move_local", relativePath: "new.md", driveItemId: "remote-spec" }),
      expect.objectContaining({ kind: "download", relativePath: "new.md", driveItemId: "remote-spec" }),
    ])
    expect(operations).not.toContainEqual(expect.objectContaining({ kind: "download", relativePath: "old.md" }))
  })

  it("skips restored descendants after a previous page downloads the restored folder", async () => {
    const accountService = createAccountService([
      page({
        items: [remoteChange({ id: "change:folder", itemId: "remote-folder", type: "restored", pathHint: "/Docs/Project", itemKind: "folder" })],
        nextCursor: "42",
        hasMore: true,
      }),
      page({
        items: [
          remoteChange({ id: "change:spec", itemId: "remote-spec", type: "restored", pathHint: "/Docs/Project/spec.md", itemKind: "file", sequence: "43" }),
          remoteChange({ id: "change:assets", itemId: "remote-assets", type: "restored", pathHint: "/Docs/Project/assets", itemKind: "folder", sequence: "44" }),
        ],
        nextCursor: "44",
      }),
    ])
    const operations: unknown[] = []

    await pollDriveSyncRemoteChanges({
      binding: binding({ remoteCursor: "41" }),
      baseline: [],
      accountService,
      onOperations: async (items) => { operations.push(...items) },
      onConflicts: async () => undefined,
      updateBindingCursor: async () => undefined,
    })

    expect(operations).toEqual([
      expect.objectContaining({ kind: "download", relativePath: "Project", driveItemId: "remote-folder" }),
    ])
  })

  it("emits one resync operation without advancing cursor when the server requires resync", async () => {
    const accountService = createAccountService([
      page({ items: [], nextCursor: "50", resyncRequired: true }),
    ])
    const operations: unknown[] = []
    const updateCursor = vi.fn()

    await pollDriveSyncRemoteChanges({
      binding: binding({ remoteCursor: "bad-cursor" }),
      baseline: [],
      accountService,
      onOperations: async (items) => { operations.push(...items) },
      onConflicts: async () => undefined,
      updateBindingCursor: updateCursor,
    })

    expect(operations).toEqual([
      expect.objectContaining({ kind: "resync", relativePath: "", driveItemId: "drive-root" }),
    ])
    expect(updateCursor).not.toHaveBeenCalled()
  })

  it("deduplicates repeated remote change ids in one polling pass", async () => {
    const duplicate = remoteChange({ itemId: "remote-spec", type: "content_updated", pathHint: "/Docs/spec.md" })
    const accountService = createAccountService([
      page({ items: [duplicate, duplicate], nextCursor: "42" }),
    ])
    const operations: unknown[] = []

    await pollDriveSyncRemoteChanges({
      binding: binding({ remoteCursor: "41" }),
      baseline: [baseline({ relativePath: "spec.md", remoteItemId: "remote-spec" })],
      accountService,
      onOperations: async (items) => { operations.push(...items) },
      onConflicts: async () => undefined,
      updateBindingCursor: async () => undefined,
    })

    expect(operations).toHaveLength(1)
  })

  it("requests remote changes scoped to the binding root", async () => {
    const accountService = createAccountService([
      page({ items: [], nextCursor: "42" }),
    ])

    await pollDriveSyncRemoteChanges({
      binding: binding({ remoteCursor: "41" }),
      baseline: [],
      accountService,
      onOperations: async () => undefined,
      onConflicts: async () => undefined,
      updateBindingCursor: async () => undefined,
    })

    expect(accountService.listDriveChanges).toHaveBeenCalledWith({
      cursor: "41",
      limit: 100,
      rootItemId: "drive-root",
      rootPathHint: "/Docs",
    })
  })
})

function createAccountService(pages: readonly DriveChangeListPageDto[]) {
  const queue = [...pages]
  return {
    listDriveChanges: vi.fn(async () => {
      const next = queue.shift()
      if (!next) throw new Error("unexpected extra poll")
      return next
    }),
  }
}

function page(input: Partial<DriveChangeListPageDto>): DriveChangeListPageDto {
  return {
    items: input.items ?? [],
    nextCursor: input.nextCursor ?? null,
    hasMore: input.hasMore ?? false,
    resyncRequired: input.resyncRequired ?? false,
  }
}

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
    localHash: null,
    lastSyncedAt: "2026-06-28T00:00:00.000Z",
    deletedAt: null,
  }
}

function remoteChange(input: Pick<DriveChangeDto, "itemId" | "type"> & {
  readonly id?: string
  readonly pathHint: string
  readonly sequence?: string
  readonly itemKind?: DriveChangeDto["itemKind"]
}): DriveChangeDto {
  return {
    id: input.id ?? `change:${input.itemId}`,
    sequence: input.sequence ?? "42",
    itemId: input.itemId,
    parentId: null,
    type: input.type,
    versionId: null,
    etag: null,
    name: input.pathHint.split("/").at(-1) ?? null,
    pathHint: input.pathHint,
    itemKind: input.itemKind ?? null,
    actor: "user",
    occurredAt: "2026-06-28T00:00:00.000Z",
  }
}
