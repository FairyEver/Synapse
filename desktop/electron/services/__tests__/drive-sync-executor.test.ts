import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DriveSyncBaselineEntryV1, DriveSyncBindingEntryV1 } from "../../runtime/data-repo"
import { createDriveSyncBaselineStore } from "../drive-sync-baseline"
import { createDefaultDriveSyncExcludeRules } from "../drive-sync-excludes"
import { executeDriveSyncOperation } from "../drive-sync-executor"
import type { DriveSyncPlannedOperation } from "../drive-sync-planner"

describe("drive sync executor", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-executor-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("downloads remote files and updates baseline", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const records: unknown[] = []
    const bindingEntry = binding({ localPath: tempDir })
    const accountService = createAccountService({
      downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
        await writeFile(outputPath, "remote", "utf8")
        return { ok: true as const, path: outputPath }
      }),
    })

    await executeDriveSyncOperation({
      binding: bindingEntry,
      operation: operation({
        kind: "download",
        relativePath: "spec.md",
        driveItemId: "remote-spec",
        localPath: path.join(tempDir, "spec.md"),
      }),
      baselineStore: createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow }),
      accountService,
      recordOperation: async (record) => { records.push(record) },
      trashLocalPath: vi.fn(),
    })

    await expect(readFile(path.join(tempDir, "spec.md"), "utf8")).resolves.toBe("remote")
    await expect(namespace.list()).resolves.toMatchObject([
      { bindingId: "binding-1", relativePath: "spec.md", remoteItemId: "remote-spec", kind: "file" },
    ])
    expect(records).toEqual([
      expect.objectContaining({ kind: "download", status: "succeeded", relativePath: "spec.md" }),
    ])
  })

  it("rejects remote file downloads through symlinked local folders", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const records: unknown[] = []
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-outside-"))
    try {
      await symlink(outsideDir, path.join(tempDir, "linked"), "dir")
      const downloadDriveFile = vi.fn(async ({ outputPath }: { outputPath: string }) => {
        await writeFile(outputPath, "remote", "utf8")
        return { ok: true as const, path: outputPath }
      })
      const accountService = createAccountService({ downloadDriveFile })

      await expect(executeDriveSyncOperation({
        binding: binding({ localPath: tempDir }),
        operation: operation({
          kind: "download",
          relativePath: "linked/spec.md",
          driveItemId: "remote-spec",
          localPath: path.join(tempDir, "linked", "spec.md"),
        }),
        baselineStore: createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow }),
        accountService,
        recordOperation: async (record) => { records.push(record) },
        trashLocalPath: vi.fn(),
      })).rejects.toThrow("同步路径包含符号链接，已停止写入。")

      expect(downloadDriveFile).not.toHaveBeenCalled()
      await expect(readFile(path.join(outsideDir, "spec.md"), "utf8")).rejects.toThrow()
      await expect(namespace.list()).resolves.toEqual([])
      expect(records).toEqual([
        expect.objectContaining({ kind: "download", status: "error", relativePath: "linked/spec.md", message: "同步路径包含符号链接，已停止写入。" }),
      ])
    } finally {
      await rm(outsideDir, { recursive: true, force: true })
    }
  })

  it("creates local folders for remote folder downloads", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const records: unknown[] = []
    const bindingEntry = binding({ localPath: tempDir })
    const accountService = createAccountService()

    await executeDriveSyncOperation({
      binding: bindingEntry,
      operation: operation({
        kind: "download",
        relativePath: "notes",
        driveItemId: "remote-notes",
        localPath: path.join(tempDir, "notes"),
        remoteItemKind: "folder",
      }),
      baselineStore: createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow }),
      accountService,
      recordOperation: async (record) => { records.push(record) },
      trashLocalPath: vi.fn(),
    })

    expect(accountService.downloadDriveFile).not.toHaveBeenCalled()
    await expect(namespace.list()).resolves.toMatchObject([
      { bindingId: "binding-1", relativePath: "notes", remoteItemId: "remote-notes", kind: "folder" },
    ])
    expect(records).toEqual([
      expect.objectContaining({ kind: "download", status: "succeeded", relativePath: "notes" }),
    ])
  })

  it("recursively downloads remote folder descendants without existing local baselines", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const bindingEntry = binding({ localPath: tempDir })
    const accountService = createAccountService({
      listDriveItemTree: vi.fn(async ({ parentId }: { parentId?: string | null }) => {
        if (parentId === "remote-project") {
          return {
            items: [
              { id: "remote-docs", name: "docs", type: "folder", path: "Docs/Project/docs" },
              { id: "remote-spec", name: "spec.md", type: "file", path: "Docs/Project/docs/spec.md" },
            ],
            nextOffset: null,
          }
        }
        return { items: [], nextOffset: null }
      }),
      downloadDriveFile: vi.fn(async ({ itemId, outputPath }: { itemId: string; outputPath: string }) => {
        await writeFile(outputPath, itemId, "utf8")
        return { ok: true as const, path: outputPath }
      }),
    })

    await executeDriveSyncOperation({
      binding: bindingEntry,
      operation: operation({
        kind: "download",
        relativePath: "Project",
        driveItemId: "remote-project",
        localPath: path.join(tempDir, "Project"),
        remoteItemKind: "folder",
        remotePathHint: "/Docs/Project",
      }),
      baselineStore: createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow }),
      accountService,
      recordOperation: async () => undefined,
      trashLocalPath: vi.fn(),
    })

    await expect(readFile(path.join(tempDir, "Project", "docs", "spec.md"), "utf8")).resolves.toBe("remote-spec")
    await expect(namespace.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: "Project", remoteItemId: "remote-project", kind: "folder" }),
      expect.objectContaining({ relativePath: "Project/docs", remoteItemId: "remote-docs", kind: "folder" }),
      expect.objectContaining({ relativePath: "Project/docs/spec.md", remoteItemId: "remote-spec", kind: "file" }),
    ]))
  })

  it("uploads local files and updates baseline with the remote item id", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const records: unknown[] = []
    await writeFile(path.join(tempDir, "local.md"), "local", "utf8")
    const accountService = createAccountService({
      uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
      listDriveItemTree: vi.fn(async () => ({
        items: [
          { id: "nested-local", name: "local.md", type: "file", path: "Docs/Archive/local.md", depth: 2 },
          { id: "remote-local", name: "local.md", type: "file", path: "Docs/local.md", depth: 1 },
        ],
      })),
    })

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "upload",
        relativePath: "local.md",
        driveItemId: null,
        localPath: path.join(tempDir, "local.md"),
      }),
      baselineStore: createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow }),
      accountService,
      recordOperation: async (record) => { records.push(record) },
      trashLocalPath: vi.fn(),
    })

    expect(accountService.uploadDriveLocalItems).toHaveBeenCalled()
    await expect(namespace.list()).resolves.toMatchObject([
      { relativePath: "local.md", remoteItemId: "remote-local", kind: "file" },
    ])
    expect(records).toEqual([
      expect.objectContaining({ kind: "upload", status: "succeeded", relativePath: "local.md" }),
    ])
  })

  it("uploads modified single-file bindings to the remote file parent folder", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const records: unknown[] = []
    const localPath = path.join(tempDir, "bound.md")
    await writeFile(localPath, "local", "utf8")
    const accountService = createAccountService({
      getDriveItem: vi.fn(async () => ({
        id: "remote-bound",
        parentId: "remote-parent",
        type: "file",
        name: "bound.md",
        size: "5",
        mimeType: "text/markdown",
        storageStatus: "active",
        shared: false,
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      })),
      uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
    })

    await executeDriveSyncOperation({
      binding: binding({ kind: "file", driveItemId: "remote-bound", localPath }),
      operation: operation({
        kind: "upload",
        relativePath: "",
        driveItemId: "remote-bound",
        localPath,
      }),
      baselineStore: createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow }),
      accountService,
      recordOperation: async (record) => { records.push(record) },
      trashLocalPath: vi.fn(),
    })

    expect(accountService.getDriveItem).toHaveBeenCalledWith("remote-bound")
    expect(accountService.uploadDriveLocalItems).toHaveBeenCalledWith(expect.objectContaining({ parentId: "remote-parent" }))
    await expect(namespace.list()).resolves.toContainEqual(
      expect.objectContaining({ relativePath: "", remoteItemId: "remote-bound", kind: "file" }),
    )
    expect(records).toEqual([
      expect.objectContaining({ kind: "upload", status: "succeeded", relativePath: "" }),
    ])
  })

  it("creates remote folders for local folder uploads", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    await mkdir(path.join(tempDir, "Folder"))
    const accountService = createAccountService({
      createDriveFolder: vi.fn(async () => ({ id: "remote-folder", name: "Folder", type: "folder" })),
    })

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({ kind: "upload", relativePath: "Folder", driveItemId: null, localPath: path.join(tempDir, "Folder") }),
      baselineStore: createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow }),
      accountService,
      recordOperation: async () => undefined,
      trashLocalPath: vi.fn(),
    })

    expect(accountService.createDriveFolder).toHaveBeenCalledWith({ parentId: "drive-root", name: "Folder" })
    await expect(namespace.list()).resolves.toMatchObject([
      { relativePath: "Folder", remoteItemId: "remote-folder", kind: "folder" },
    ])
  })

  it("uploads nested files under their remote parent folder", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const store = createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow })
    await mkdir(path.join(tempDir, "Folder"), { recursive: true })
    await writeFile(path.join(tempDir, "Folder", "local.md"), "local", "utf8")
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "Folder",
      kind: "folder",
      remoteItemId: "remote-folder",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })
    const accountService = createAccountService({
      uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
      listDriveItemTree: vi.fn(async () => ({
        items: [{ id: "remote-local", name: "local.md", type: "file", path: "Docs/Folder/local.md", depth: 2 }],
      })),
    })

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "upload",
        relativePath: "Folder/local.md",
        driveItemId: null,
        localPath: path.join(tempDir, "Folder", "local.md"),
      }),
      baselineStore: store,
      accountService,
      recordOperation: async () => undefined,
      trashLocalPath: vi.fn(),
    })

    expect(accountService.uploadDriveLocalItems).toHaveBeenCalledWith(expect.objectContaining({ parentId: "remote-folder" }))
    await expect(namespace.list()).resolves.toContainEqual(
      expect.objectContaining({ relativePath: "Folder/local.md", remoteItemId: "remote-local", kind: "file" }),
    )
  })

  it("moves local entries for remote rename or move changes", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const store = createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow })
    await mkdir(path.join(tempDir, "old"), { recursive: true })
    await writeFile(path.join(tempDir, "old", "spec.md"), "remote", "utf8")
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "old/spec.md",
      kind: "file",
      remoteItemId: "remote-spec",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "move_local",
        relativePath: "new/spec.md",
        driveItemId: "remote-spec",
        localPath: path.join(tempDir, "new", "spec.md"),
      }),
      baselineStore: store,
      accountService: createAccountService(),
      recordOperation: async () => undefined,
      trashLocalPath: vi.fn(),
    })

    await expect(readFile(path.join(tempDir, "new", "spec.md"), "utf8")).resolves.toBe("remote")
    await expect(namespace.list()).resolves.toMatchObject([
      { relativePath: "new/spec.md", remoteItemId: "remote-spec", deletedAt: null },
    ])
  })

  it("rewrites descendant baselines when moving local folders", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const store = createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow })
    await mkdir(path.join(tempDir, "old"), { recursive: true })
    await writeFile(path.join(tempDir, "old", "spec.md"), "remote", "utf8")
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "old",
      kind: "folder",
      remoteItemId: "remote-folder",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "old/spec.md",
      kind: "file",
      remoteItemId: "remote-spec",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: 6,
      localMtimeMs: 1,
      localHash: "sha256:old",
      deletedAt: null,
    })

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "move_local",
        relativePath: "new",
        driveItemId: "remote-folder",
        localPath: path.join(tempDir, "new"),
      }),
      baselineStore: store,
      accountService: createAccountService(),
      recordOperation: async () => undefined,
      trashLocalPath: vi.fn(),
    })

    await expect(readFile(path.join(tempDir, "new", "spec.md"), "utf8")).resolves.toBe("remote")
    await expect(namespace.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: "new", remoteItemId: "remote-folder", deletedAt: null }),
      expect.objectContaining({ relativePath: "new/spec.md", remoteItemId: "remote-spec", deletedAt: null }),
    ]))
    await expect(namespace.get("binding-1:old")).resolves.toBeNull()
    await expect(namespace.get("binding-1:old/spec.md")).resolves.toBeNull()
  })

  it("moves remote files for local renames without changing remote identity", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const store = createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow })
    await writeFile(path.join(tempDir, "new.md"), "local", "utf8")
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "old.md",
      kind: "file",
      remoteItemId: "remote-old",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: 5,
      localMtimeMs: 1,
      localHash: "sha256:old",
      deletedAt: null,
    })
    const accountService = createAccountService()

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "move_remote",
        relativePath: "new.md",
        driveItemId: "remote-old",
        localPath: path.join(tempDir, "new.md"),
      }),
      baselineStore: store,
      accountService,
      recordOperation: async () => undefined,
      trashLocalPath: vi.fn(),
    })

    expect(accountService.moveDriveItem).toHaveBeenCalledWith("remote-old", "drive-root")
    expect(accountService.renameDriveItem).toHaveBeenCalledWith("remote-old", "new.md")
    await expect(namespace.list()).resolves.toEqual([
      expect.objectContaining({ relativePath: "new.md", remoteItemId: "remote-old", kind: "file", deletedAt: null }),
    ])
  })

  it("moves remote folders and rewrites descendant baselines for local folder renames", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const store = createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow })
    await mkdir(path.join(tempDir, "new"), { recursive: true })
    await writeFile(path.join(tempDir, "new", "spec.md"), "remote", "utf8")
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "old",
      kind: "folder",
      remoteItemId: "remote-folder",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "old/spec.md",
      kind: "file",
      remoteItemId: "remote-spec",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: 6,
      localMtimeMs: 1,
      localHash: "sha256:old",
      deletedAt: null,
    })
    const accountService = createAccountService()

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "move_remote",
        relativePath: "new",
        driveItemId: "remote-folder",
        localPath: path.join(tempDir, "new"),
      }),
      baselineStore: store,
      accountService,
      recordOperation: async () => undefined,
      trashLocalPath: vi.fn(),
    })

    expect(accountService.moveDriveItem).toHaveBeenCalledWith("remote-folder", "drive-root")
    expect(accountService.renameDriveItem).toHaveBeenCalledWith("remote-folder", "new")
    await expect(namespace.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: "new", remoteItemId: "remote-folder", deletedAt: null }),
      expect.objectContaining({ relativePath: "new/spec.md", remoteItemId: "remote-spec", deletedAt: null }),
    ]))
    await expect(namespace.get("binding-1:old")).resolves.toBeNull()
    await expect(namespace.get("binding-1:old/spec.md")).resolves.toBeNull()
  })

  it("deletes local files through a recoverable trash strategy", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const store = createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow })
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "gone.md",
      kind: "file",
      remoteItemId: "remote-gone",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })
    const trashLocalPath = vi.fn(async () => undefined)

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "delete_local",
        relativePath: "gone.md",
        driveItemId: "remote-gone",
        localPath: path.join(tempDir, "gone.md"),
      }),
      baselineStore: store,
      accountService: createAccountService(),
      recordOperation: async () => undefined,
      trashLocalPath,
    })

    expect(trashLocalPath).toHaveBeenCalledWith(path.join(tempDir, "gone.md"))
    await expect(namespace.list()).resolves.toMatchObject([
      { relativePath: "gone.md", deletedAt: "2026-06-28T00:00:00.000Z" },
    ])
  })

  it("treats missing remote items as successful remote deletes", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const records: unknown[] = []
    const store = createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow })
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "gone.md",
      kind: "file",
      remoteItemId: "remote-gone",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })
    const accountService = createAccountService({
      deleteDriveItem: vi.fn(async () => {
        throw Object.assign(new Error("HTTP 404 NOT_FOUND"), { status: 404 })
      }),
    })

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "delete_remote",
        relativePath: "gone.md",
        driveItemId: "remote-gone",
        localPath: path.join(tempDir, "gone.md"),
      }),
      baselineStore: store,
      accountService,
      recordOperation: async (record) => { records.push(record) },
      trashLocalPath: vi.fn(),
    })

    await expect(namespace.list()).resolves.toMatchObject([
      { relativePath: "gone.md", deletedAt: "2026-06-28T00:00:00.000Z" },
    ])
    expect(records).toEqual([
      expect.objectContaining({ kind: "delete_remote", status: "succeeded", message: null }),
    ])
  })

  it("treats missing local paths as successful local deletes", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const records: unknown[] = []
    const store = createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow })
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "gone.md",
      kind: "file",
      remoteItemId: "remote-gone",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })

    await executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "delete_local",
        relativePath: "gone.md",
        driveItemId: "remote-gone",
        localPath: path.join(tempDir, "gone.md"),
      }),
      baselineStore: store,
      accountService: createAccountService(),
      recordOperation: async (record) => { records.push(record) },
      trashLocalPath: vi.fn(async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      }),
    })

    await expect(namespace.list()).resolves.toMatchObject([
      { relativePath: "gone.md", deletedAt: "2026-06-28T00:00:00.000Z" },
    ])
    expect(records).toEqual([
      expect.objectContaining({ kind: "delete_local", status: "succeeded", message: null }),
    ])
  })

  it("rejects nested uploads when the parent folder baseline is missing", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const records: unknown[] = []
    const localPath = path.join(tempDir, "Project", "spec.md")
    await mkdir(path.dirname(localPath), { recursive: true })
    await writeFile(localPath, "spec", "utf8")
    const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))

    await expect(executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "upload",
        driveItemId: null,
        relativePath: "Project/spec.md",
        localPath,
      }),
      baselineStore: createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow }),
      accountService: createAccountService({ uploadDriveLocalItems }),
      recordOperation: async (record) => { records.push(record) },
      trashLocalPath: vi.fn(),
    })).rejects.toThrow("云盘父文件夹尚未同步，已停止上传子项。")

    expect(uploadDriveLocalItems).not.toHaveBeenCalled()
    await expect(namespace.list()).resolves.toEqual([])
    expect(records).toEqual([
      expect.objectContaining({
        kind: "upload",
        status: "error",
        relativePath: "Project/spec.md",
        message: "云盘父文件夹尚未同步，已停止上传子项。",
      }),
    ])
  })

  it("records failed operations without updating baseline", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const records: unknown[] = []
    const accountService = createAccountService({
      downloadDriveFile: vi.fn(async () => {
        throw new Error("disk unavailable Authorization: Bearer raw-bearer token=plain-secret /Users/me/private/secret.md")
      }),
    })

    await expect(executeDriveSyncOperation({
      binding: binding({ localPath: tempDir }),
      operation: operation({
        kind: "download",
        relativePath: "spec.md",
        driveItemId: "remote-spec",
        localPath: path.join(tempDir, "spec.md"),
      }),
      baselineStore: createDriveSyncBaselineStore({ baseline: namespace, now: fixedNow }),
      accountService,
      recordOperation: async (record) => { records.push(record) },
      trashLocalPath: vi.fn(),
    })).rejects.toThrow("disk unavailable")

    await expect(namespace.list()).resolves.toEqual([])
    expect(records).toEqual([
      expect.objectContaining({
        kind: "download",
        status: "error",
        message: expect.stringContaining("[redacted]"),
      }),
    ])
    expect(JSON.stringify(records)).not.toContain("raw-bearer")
    expect(JSON.stringify(records)).not.toContain("plain-secret")
    expect(JSON.stringify(records)).not.toContain("/Users/me/private/secret.md")
  })
})

function fixedNow(): Date {
  return new Date("2026-06-28T00:00:00.000Z")
}

function binding(input: Partial<DriveSyncBindingEntryV1>): DriveSyncBindingEntryV1 {
  return {
    id: "binding-1",
    schemaVersion: 1,
    driveItemId: "drive-root",
    driveItemName: "Docs",
    kind: "folder",
    drivePathHint: "/Docs",
    localPath: input.localPath ?? "/Users/me/Docs",
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

function operation(input: Partial<DriveSyncPlannedOperation> & {
  readonly kind: DriveSyncPlannedOperation["kind"]
  readonly relativePath: string
}): DriveSyncPlannedOperation {
  return {
    bindingId: "binding-1",
    kind: input.kind,
    driveItemId: input.driveItemId === undefined ? "remote-item" : input.driveItemId,
    relativePath: input.relativePath,
    localPath: input.localPath ?? path.join("/Users/me/Docs", input.relativePath),
    remotePathHint: input.remotePathHint ?? null,
    remoteItemKind: input.remoteItemKind ?? null,
  }
}

function createAccountService(overrides: Record<string, unknown> = {}) {
  return {
    getDriveItem: vi.fn(),
    downloadDriveFile: vi.fn(async () => ({ ok: true as const, path: "" })),
    downloadDriveFolderZip: vi.fn(async () => ({ ok: true as const, path: "" })),
    uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
    createDriveFolder: vi.fn(async () => ({ id: "folder-1", name: "Folder", type: "folder" })),
    renameDriveItem: vi.fn(),
    moveDriveItem: vi.fn(),
    deleteDriveItem: vi.fn(async () => ({ ok: true as const })),
    listDriveChanges: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false, resyncRequired: false })),
    listDriveItemTree: vi.fn(async () => ({ items: [] })),
    ensureDriveFolderPath: vi.fn(),
    ...overrides,
  }
}

function createMemoryNamespace<T extends Record<string, unknown>>() {
  const records = new Map<string, T>()
  return {
    name: "memory",
    schemaVersion: 1,
    backend: "sqlite" as const,
    async getSingleton() { return null },
    async setSingleton() {},
    async clearSingleton() {},
    async list(filter?: Partial<T>) {
      const entries = Array.from(records.values())
      if (!filter) return entries
      return entries.filter((entry) =>
        Object.entries(filter).every(([key, value]) => entry[key as keyof T] === value),
      )
    },
    async count() { return records.size },
    async get(id: string) { return records.get(id) ?? null },
    async upsert(item: T) { records.set(item.id as string, item) },
    async remove(id: string) { records.delete(id) },
    onChange() { return () => undefined },
  }
}
