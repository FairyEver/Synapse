import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DriveItemDto } from "@synapse/shared"
import type {
  DataNamespace,
  DriveSyncBaselineEntryV1,
  DriveSyncBindingEntryV1,
  DriveSyncConflictEntryV1,
  DriveSyncOperationEntryV1,
  DriveSyncStateEntryV1,
} from "../../runtime/data-repo"
import { createDriveSyncService, type DriveSyncLocalScanEntry } from "../drive-sync-service"

afterEach(() => {
  vi.useRealTimers()
})

describe("DriveSyncService", () => {
  it("creates bindings and exposes a sync snapshot", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)

    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
      remoteCursor: "42",
      excludeRules: [".git/**"],
    })

    expect(binding).toMatchObject({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      localPath: "/Users/me/docs",
      status: "active",
      remoteCursor: "42",
    })
    await expect(service.getSnapshot()).resolves.toMatchObject({
      bindings: [binding],
      conflicts: [],
      operations: [],
      summary: {
        activeBindingCount: 1,
        runningOperationCount: 0,
        conflictCount: 0,
        errorCount: 0,
      },
    })
  })

  it("rejects duplicate active drive items and local paths", async () => {
    const service = createDriveSyncService(createHarness().deps)
    await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
    })

    await expect(service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/other",
    })).rejects.toThrow("云盘条目已绑定。")
    await expect(service.createBinding({
      driveItemId: "drive-item-2",
      driveItemName: "资料",
      kind: "folder",
      drivePathHint: "/资料",
      localPath: "/Users/me/docs",
    })).rejects.toThrow("本地路径已绑定。")
  })

  it("records operations, conflicts, and health for snapshots", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
    })

    const operation = await service.recordOperation({
      bindingId: binding.id,
      kind: "download",
      status: "running",
      driveItemId: "drive-item-1",
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      message: null,
    })
    const conflict = await service.recordConflict({
      bindingId: binding.id,
      driveItemId: "drive-item-1",
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      type: "both_modified",
      localSnapshot: { mtimeMs: 1000 },
      remoteSnapshot: { sequence: "43" },
    })
    await service.setHealth({ health: "error", lastError: "network unavailable" })

    await expect(service.getSnapshot()).resolves.toMatchObject({
      conflicts: [conflict],
      operations: [operation],
      summary: {
        activeBindingCount: 0,
        runningOperationCount: 1,
        conflictCount: 1,
        errorCount: 0,
      },
    })
    await expect(harness.state.getSingleton()).resolves.toMatchObject({
      health: "error",
      lastError: "network unavailable",
    })
  })

  it("starts active bindings with one local rescan and remote poll, then polls every minute without reentry", async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    const service = createDriveSyncService({
      ...harness.deps,
      syncIntervalMs: 60_000,
    })
    await service.createBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/Users/me/docs",
    })

    await service.start()

    expect(harness.fs.watch).toHaveBeenCalledWith("/Users/me/docs", expect.any(Function))
    expect(harness.fs.scan).toHaveBeenCalledWith("/Users/me/docs", expect.any(Object))
    expect(harness.drive.listDriveChanges).toHaveBeenCalledTimes(1)

    let releasePoll: (() => void) | undefined
    harness.drive.listDriveChanges.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releasePoll = resolve })
      return { items: [], nextCursor: "2", hasMore: false, resyncRequired: false }
    })
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.drive.listDriveChanges).toHaveBeenCalledTimes(2)

    if (releasePoll) releasePoll()
    await vi.runOnlyPendingTimersAsync()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.drive.listDriveChanges.mock.calls.length).toBeGreaterThanOrEqual(3)

    await service.stop()
    expect(harness.watchClose).toHaveBeenCalledTimes(1)
  })

  it("plans a local rename as one remote move and updates baseline", async () => {
    const harness = createHarness()
    harness.fs.scan.mockResolvedValue([
      {
        kind: "file",
        relativePath: "after.md",
        absolutePath: "/Users/me/docs/after.md",
        hash: "sha256:same",
        mtimeMs: 20,
      },
    ])
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/Users/me/docs",
    })
    await harness.baselines.upsert({
      id: `${binding.id}:before.md`,
      schemaVersion: 1,
      bindingId: binding.id,
      relativePath: "before.md",
      driveItemId: "remote-file-1",
      parentDriveItemId: "folder-1",
      kind: "file",
      localHash: "sha256:same",
      localMtimeMs: 10,
      remotePathHint: "/Docs/before.md",
      remoteVersionId: null,
      remoteEtag: null,
      updatedAt: "2026-06-28T00:00:00.000Z",
    })

    await service.rescanBinding(binding.id)

    expect(harness.drive.renameDriveItem).toHaveBeenCalledWith("remote-file-1", "after.md")
    expect(harness.drive.moveDriveItem).not.toHaveBeenCalled()
    await expect(harness.baselines.get(`${binding.id}:before.md`)).resolves.toBeNull()
    await expect(harness.baselines.get(`${binding.id}:after.md`)).resolves.toMatchObject({
      driveItemId: "remote-file-1",
      relativePath: "after.md",
    })
  })

  it("records a path conflict instead of moving over an occupied target", async () => {
    const harness = createHarness()
    harness.fs.scan.mockResolvedValue([
      {
        kind: "file",
        relativePath: "target.md",
        absolutePath: "/Users/me/docs/target.md",
        hash: "sha256:same",
        mtimeMs: 20,
      },
    ])
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/Users/me/docs",
    })
    await harness.baselines.upsert(createBaseline(binding.id, "before.md", "remote-file-1", "sha256:same"))
    await harness.baselines.upsert(createBaseline(binding.id, "target.md", "remote-file-2", "sha256:target"))

    await service.rescanBinding(binding.id)

    expect(harness.drive.renameDriveItem).not.toHaveBeenCalled()
    await expect(harness.conflicts.list()).resolves.toMatchObject([
      {
        bindingId: binding.id,
        relativePath: "target.md",
        type: "path_conflict",
        status: "open",
      },
    ])
  })

  it("downloads remote folder contents when creating a cloud-to-local binding", async () => {
    const harness = createHarness()
    harness.drive.listDriveItems.mockImplementation(async (parentId: string | null) => {
      if (parentId === "folder-1") {
        return [
          createDriveItem({ id: "file-1", parentId: "folder-1", name: "a.md", type: "file" }),
          createDriveItem({ id: "git-folder", parentId: "folder-1", name: ".git", type: "folder" }),
        ]
      }
      return []
    })
    harness.fs.scan.mockResolvedValue([{
      kind: "file",
      relativePath: "",
      absolutePath: "/Users/me/docs/a.md",
      hash: "sha256:file",
      mtimeMs: 30,
    }])
    const service = createDriveSyncService(harness.deps)

    const binding = await service.createBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      drivePathHint: "/Docs",
      localPath: "/Users/me/docs",
      initialDirection: "download_remote",
    })

    expect(harness.fs.ensureDirectory).toHaveBeenCalledWith("/Users/me/docs")
    expect(harness.drive.downloadDriveFile).toHaveBeenCalledWith({
      itemId: "file-1",
      outputPath: "/Users/me/docs/a.md",
    })
    expect(harness.drive.listDriveItems).not.toHaveBeenCalledWith("git-folder")
    await expect(harness.baselines.get(`${binding.id}:a.md`)).resolves.toMatchObject({
      driveItemId: "file-1",
      localHash: "sha256:file",
    })
  })

  it("rejects initial cloud downloads into occupied local targets", async () => {
    const harness = createHarness()
    harness.fs.isInitialDownloadTargetAvailable.mockResolvedValue(false)
    const service = createDriveSyncService(harness.deps)

    await expect(service.createBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/Users/me/docs",
      initialDirection: "download_remote",
    })).rejects.toThrow("本地文件夹必须为空或不存在。")

    await expect(harness.bindings.list()).resolves.toEqual([])
    expect(harness.drive.downloadDriveFile).not.toHaveBeenCalled()
  })

  it("retries a persisted failed operation by id", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: "/Users/me/docs",
    })
    await harness.operations.upsert({
      id: "op-1",
      schemaVersion: 1,
      bindingId: binding.id,
      kind: "download",
      status: "error",
      driveItemId: "remote-file-1",
      relativePath: "a.md",
      localPath: "/Users/me/docs/a.md",
      remotePathHint: "/Docs/a.md",
      message: "network",
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
      startedAt: null,
      completedAt: "2026-06-28T00:00:00.000Z",
    })

    await service.retryOperation({ id: "op-1" })

    expect(harness.drive.downloadDriveFile).toHaveBeenCalledWith({
      itemId: "remote-file-1",
      outputPath: "/Users/me/docs/a.md",
    })
    await expect(harness.operations.get("op-1")).resolves.toMatchObject({
      status: "succeeded",
      message: null,
    })
  })
})

function createHarness() {
  const baselines = createMemoryNamespace<DriveSyncBaselineEntryV1>()
  const bindings = createMemoryNamespace<DriveSyncBindingEntryV1>()
  const operations = createMemoryNamespace<DriveSyncOperationEntryV1>()
  const conflicts = createMemoryNamespace<DriveSyncConflictEntryV1>()
  const state = createMemoryNamespace<DriveSyncStateEntryV1>()
  const watchClose = vi.fn()
  const fs = {
    watch: vi.fn(() => ({ close: watchClose })),
    scan: vi.fn(async (): Promise<DriveSyncLocalScanEntry[]> => []),
    trashLocalPath: vi.fn(async () => undefined),
    ensureParentDirectory: vi.fn(async () => undefined),
    ensureDirectory: vi.fn(async () => undefined),
    isInitialDownloadTargetAvailable: vi.fn(async () => true),
  }
  const drive = {
    listDriveChanges: vi.fn(async () => ({ items: [], nextCursor: "1", hasMore: false, resyncRequired: false })),
    listDriveItems: vi.fn(async (_parentId: string | null): Promise<DriveItemDto[]> => []),
    downloadDriveFile: vi.fn(async () => ({ ok: true as const, path: "/Users/me/docs/a.md" })),
    uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
    renameDriveItem: vi.fn(async () => undefined),
    moveDriveItem: vi.fn(async () => undefined),
    deleteDriveItem: vi.fn(async () => ({ ok: true as const })),
    createDriveFolder: vi.fn(async () => ({ id: "new-folder", parentId: null, type: "folder" as const, name: "new-folder", size: "0", mimeType: null, storageStatus: "active" as const, shared: false, createdAt: "2026-06-28T00:00:00.000Z", updatedAt: "2026-06-28T00:00:00.000Z" })),
  }
  return {
    baselines,
    bindings,
    operations,
    conflicts,
    state,
    fs,
    drive,
    watchClose,
    deps: {
      baselines,
      bindings,
      operations,
      conflicts,
      state,
      fs,
      drive,
      now: () => new Date("2026-06-28T00:00:00.000Z"),
      createId: (prefix: string) => `${prefix}-${Math.random().toString(16).slice(2)}`,
    },
  }
}

function createBaseline(
  bindingId: string,
  relativePath: string,
  driveItemId: string,
  localHash: string,
): DriveSyncBaselineEntryV1 {
  return {
    id: `${bindingId}:${relativePath}`,
    schemaVersion: 1,
    bindingId,
    relativePath,
    driveItemId,
    parentDriveItemId: "folder-1",
    kind: "file",
    localHash,
    localMtimeMs: 10,
    remotePathHint: `/Docs/${relativePath}`,
    remoteVersionId: null,
    remoteEtag: null,
    updatedAt: "2026-06-28T00:00:00.000Z",
  }
}

function createDriveItem(overrides: Partial<DriveItemDto> = {}): DriveItemDto {
  return {
    id: overrides.id ?? "drive-item-1",
    parentId: overrides.parentId ?? null,
    type: overrides.type ?? "file",
    name: overrides.name ?? "item.md",
    size: overrides.size ?? "0",
    mimeType: overrides.mimeType ?? null,
    storageStatus: overrides.storageStatus ?? "active",
    shared: overrides.shared ?? false,
    activeShareId: overrides.activeShareId ?? null,
    createdAt: overrides.createdAt ?? "2026-06-28T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-28T00:00:00.000Z",
  }
}

function createMemoryNamespace<T extends Record<string, unknown>>() {
  const events = new EventEmitter()
  let singleton: T | null = null
  const records = new Map<string, T>()
  const namespace: DataNamespace<T> & { records: Map<string, T> } = {
    name: "memory",
    schemaVersion: 1,
    backend: "sqlite",
    records,
    async getSingleton() { return singleton },
    async setSingleton(value) { singleton = value },
    async clearSingleton() { singleton = null },
    async list(filter?: Partial<T>) {
      const entries = Array.from(records.values())
      if (!filter) return entries
      return entries.filter((entry) =>
        Object.entries(filter).every(([key, value]) => entry[key as keyof T] === value),
      )
    },
    async count() { return records.size },
    async get(id) { return records.get(id) ?? null },
    async upsert(item) { records.set(item.id, item) },
    async remove(id) { records.delete(id) },
    onChange(listener) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  }
  return namespace
}
