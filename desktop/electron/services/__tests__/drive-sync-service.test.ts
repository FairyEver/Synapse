import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import type {
  DataNamespace,
  DriveSyncBindingEntryV1,
  DriveSyncConflictEntryV1,
  DriveSyncOperationEntryV1,
  DriveSyncStateEntryV1,
} from "../../runtime/data-repo"
import { createDriveSyncService } from "../drive-sync-service"

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
})

function createHarness() {
  const bindings = createMemoryNamespace<DriveSyncBindingEntryV1>()
  const operations = createMemoryNamespace<DriveSyncOperationEntryV1>()
  const conflicts = createMemoryNamespace<DriveSyncConflictEntryV1>()
  const state = createMemoryNamespace<DriveSyncStateEntryV1>()
  return {
    bindings,
    operations,
    conflicts,
    state,
    deps: {
      bindings,
      operations,
      conflicts,
      state,
      now: () => new Date("2026-06-28T00:00:00.000Z"),
      createId: (prefix: string) => `${prefix}-1`,
    },
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
