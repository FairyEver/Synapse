import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DriveService } from "./drive.service"
import { DriveChangeLogService } from "./drive-change-log"

const row = (id: string, parentId: string | null = null, type = "file") => ({
  id, userId: "owner", parentId, type, name: id, size: 4n, mimeType: null, storageKey: `private/${id}`,
  storageStatus: "active", shares: [], createdAt: new Date(0), updatedAt: new Date(0),
})
beforeEach(() => vi.stubEnv("USER_ACCESS_JWT_SECRET", "drive-batch-test-secret-32-characters"))
afterEach(() => vi.unstubAllEnvs())

describe("Drive batch item reads", () => {
  it("shares parent queries and returns current versions without storage keys", async () => {
    const rows = [row("a", "parent"), row("b", "parent"), row("parent", null, "folder")]
    const prisma = {
      driveItem: { findMany: vi.fn(async ({ where }) => rows.filter((r) => where.id.in.includes(r.id) && where.userId === r.userId)) },
      driveFileVersion: { findMany: vi.fn(async () => [{ id: "v-a", itemId: "a", storageKey: "private/a", etag: "etag-a" }]) },
    }
    const service = new DriveService(prisma as never, {} as never)
    const result = await service.getItemsBatch("owner", ["a", "b", "a"])
    expect(result.results).toHaveLength(2)
    expect(result.results[0]).toMatchObject({ itemId: "a", error: null, data: { item: { id: "a" }, ancestors: [{ id: "parent" }], currentVersionId: "v-a", etag: "etag-a" } })
    expect(prisma.driveItem.findMany).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(result)).not.toContain("private/")
  })

  it("isolates unavailable items and incomplete or cyclic ancestry", async () => {
    const rows = [row("ok"), row("broken", "missing"), row("cycle", "cycle")]
    const prisma = {
      driveItem: { findMany: vi.fn(async ({ where }) => rows.filter((r) => where.id.in.includes(r.id) && where.userId === r.userId)) },
      driveFileVersion: { findMany: vi.fn(async () => []) },
    }
    const service = new DriveService(prisma as never, {} as never)
    const result = await service.getItemsBatch("owner", ["ok", "foreign", "broken", "cycle"])
    expect(result.results.map((r) => r.error?.status ?? 200)).toEqual([200, 404, 409, 409])
    expect(result.results[1].data).toBeNull()
    expect(prisma.driveItem.findMany.mock.calls.length).toBeLessThan(5)
  })

  it("rejects oversized batches before querying", async () => {
    const findMany = vi.fn()
    const service = new DriveService({ driveItem: { findMany } } as never, {} as never)
    await expect(service.getItemsBatch("owner", Array.from({ length: 101 }, (_, i) => String(i)))).rejects.toThrow()
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe("Drive batch change reads", () => {
  it("keeps independent cursor pages, expired cursors and per-root failures", async () => {
    const roots = [row("a"), row("b"), row("expired")]
    const change = (requestId: string, sequence: bigint) => ({ requestId, id: `c${sequence}`, sequence, itemId: requestId, parentId: null, type: "content_updated", versionId: null, etag: null, name: requestId, pathHint: `/${requestId}`, actor: null, occurredAt: new Date(0) })
    const prisma = {
      driveItem: { findMany: vi.fn(async ({ where }) => roots.filter((r) => where.id?.in?.includes(r.id))) },
      driveChangeRetentionState: { findUnique: vi.fn(async () => ({ purgedThroughSequence: 3n })) },
      driveChange: { findFirst: vi.fn(async () => ({ sequence: 50n })) },
      $queryRaw: vi.fn(async () => [change("a", 11n), change("a", 12n), change("b", 21n)]),
    }
    const service = new DriveChangeLogService(prisma as never)
    const result = await service.listBatch("owner", [
      { requestId: "a", rootItemId: "a", cursor: "10", limit: 1 },
      { requestId: "b", rootItemId: "b", cursor: "20", limit: 1 },
      { requestId: "expired", rootItemId: "expired", cursor: "2" },
      { requestId: "foreign", rootItemId: "foreign", cursor: "0" },
    ])
    expect(result.results[0]).toMatchObject({ requestId: "a", error: null, data: { nextCursor: "11", hasMore: true, items: [{ itemId: "a" }] } })
    expect(result.results[1]).toMatchObject({ requestId: "b", data: { nextCursor: "21", hasMore: false } })
    expect(result.results[2]).toMatchObject({ requestId: "expired", data: { resyncRequired: true, nextCursor: "50" } })
    expect(result.results[3]).toMatchObject({ requestId: "foreign", data: null, error: { status: 404 } })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it.each(["invalid", "9223372036854775808", "99999999999999999999"])("isolates invalid cursor %s and rejects duplicate request identities", async (cursor) => {
    const prisma = {
      driveItem: { findMany: vi.fn(async () => [row("a")]) },
      driveChangeRetentionState: { findUnique: vi.fn(async () => ({ purgedThroughSequence: 0n })) },
      driveChange: { findFirst: vi.fn(async () => null) },
      $queryRaw: vi.fn(async () => []),
    }
    const service = new DriveChangeLogService(prisma as never)
    const result = await service.listBatch("owner", [{ requestId: "bad", rootItemId: "a", cursor }, { requestId: "good", rootItemId: "a", cursor: "10" }])
    expect(result.results[0]).toMatchObject({ error: { status: 400 }, data: null })
    expect(result.results[1]).toMatchObject({ error: null, data: { nextCursor: "10", items: [] } })
    await expect(service.listBatch("owner", [{ requestId: "same", rootItemId: "a" }, { requestId: "same", rootItemId: "b" }])).rejects.toThrow()
  })
})
