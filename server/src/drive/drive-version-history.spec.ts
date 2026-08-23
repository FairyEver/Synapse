import { describe, expect, it, vi } from "vitest"
import { listCleanupCandidateVersions } from "./drive-version-history"

describe("drive-version-history", () => {
  it("does not load pinned versions when listing cleanup candidates", async () => {
    const expiredAt = new Date("2026-01-01T00:00:00.000Z")
    const count = vi.fn(async () => 1)
    const findMany = vi.fn(async (args: { readonly where: { readonly createdAt?: unknown } }) => {
      if (args.where.createdAt) {
        return [
          { id: "version-old", storageKey: "storage-old", size: 11n },
          { id: "version-duplicate", storageKey: "storage-duplicate", size: 7n },
        ]
      }
      return [
        { id: "version-overflow", storageKey: "storage-overflow", size: 5n },
        { id: "version-duplicate", storageKey: "storage-duplicate", size: 7n },
      ]
    })
    const tx = {
      driveFileVersion: {
        count,
        findMany,
      },
    }

    await expect(listCleanupCandidateVersions(tx as never, {
      itemId: "item-1",
      currentStorageKey: "storage-current",
      now: new Date("2026-07-01T00:00:00.000Z"),
      maxCount: 3,
      retentionDays: 181,
    })).resolves.toEqual([
      { id: "version-old", storageKey: "storage-old", size: 11n },
      { id: "version-duplicate", storageKey: "storage-duplicate", size: 7n },
      { id: "version-overflow", storageKey: "storage-overflow", size: 5n },
    ])
    expect(count).toHaveBeenCalledWith({
      where: {
        itemId: "item-1",
        deletedAt: null,
        OR: [
          { isPinned: true },
          { openApiGrantEntries: { some: { grant: { leaseUntil: { gt: new Date("2026-07-01T00:00:00.000Z") } } } } },
          { storageKey: "storage-current" },
        ],
      },
    })
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: {
        itemId: "item-1",
        deletedAt: null,
        isPinned: false,
        openApiGrantEntries: { none: { grant: { leaseUntil: { gt: new Date("2026-07-01T00:00:00.000Z") } } } },
        storageKey: { not: "storage-current" },
        createdAt: { lt: expiredAt },
      },
      select: { id: true, storageKey: true, size: true },
      orderBy: { versionNumber: "desc" },
    })
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: {
        itemId: "item-1",
        deletedAt: null,
        isPinned: false,
        openApiGrantEntries: { none: { grant: { leaseUntil: { gt: new Date("2026-07-01T00:00:00.000Z") } } } },
        storageKey: { not: "storage-current" },
      },
      select: { id: true, storageKey: true, size: true },
      orderBy: { versionNumber: "desc" },
      skip: 2,
    })
  })
})
