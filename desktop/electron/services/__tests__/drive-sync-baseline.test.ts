import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import type { DataNamespace, DriveSyncBaselineEntryV1 } from "../../runtime/data-repo"
import { createDriveSyncBaselineStore } from "../drive-sync-baseline"

describe("DriveSyncBaselineStore", () => {
  it("upserts and lists baseline entries by binding", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const store = createDriveSyncBaselineStore({
      baseline: namespace,
      now: () => new Date("2026-06-28T00:00:00.000Z"),
    })

    await store.upsert({
      bindingId: "binding-1",
      relativePath: "docs/spec.md",
      kind: "file",
      remoteItemId: "item-1",
      remoteVersionId: "version-1",
      remoteEtag: "etag-1",
      localSize: 10,
      localMtimeMs: 1000,
      localHash: "sha256:abc",
      deletedAt: null,
    })

    await expect(store.listByBinding("binding-1")).resolves.toMatchObject([
      {
        id: "binding-1:docs/spec.md",
        schemaVersion: 2,
        bindingId: "binding-1",
        relativePath: "docs/spec.md",
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
      },
    ])
    await expect(store.listByBinding("binding-2")).resolves.toEqual([])
  })

  it("marks deleted entries without removing identity", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const store = createDriveSyncBaselineStore({
      baseline: namespace,
      now: () => new Date("2026-06-28T00:00:00.000Z"),
    })
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "docs/spec.md",
      kind: "file",
      remoteItemId: "item-1",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })

    const deleted = await store.markDeleted("binding-1", "docs/spec.md")

    expect(deleted).toMatchObject({
      id: "binding-1:docs/spec.md",
      remoteItemId: "item-1",
      deletedAt: "2026-06-28T00:00:00.000Z",
    })
  })

  it("removes all entries for a binding", async () => {
    const namespace = createMemoryNamespace<DriveSyncBaselineEntryV1>()
    const store = createDriveSyncBaselineStore({
      baseline: namespace,
      now: () => new Date("2026-06-28T00:00:00.000Z"),
    })
    await store.upsert({
      bindingId: "binding-1",
      relativePath: "a.md",
      kind: "file",
      remoteItemId: "item-1",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })
    await store.upsert({
      bindingId: "binding-2",
      relativePath: "b.md",
      kind: "file",
      remoteItemId: "item-2",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: null,
      localMtimeMs: null,
      localHash: null,
      deletedAt: null,
    })

    await store.removeBinding("binding-1")

    await expect(store.listByBinding("binding-1")).resolves.toEqual([])
    await expect(store.listByBinding("binding-2")).resolves.toHaveLength(1)
  })
})

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
