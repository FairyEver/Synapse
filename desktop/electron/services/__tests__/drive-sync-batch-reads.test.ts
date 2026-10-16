import { describe, expect, it, vi } from "vitest"
import { prepareDriveSyncBatchReads, type DriveSyncBatchAccount } from "../drive-sync-batch-reads"
import type { DriveSyncBindingEntryV1 } from "../../runtime/data-repo"
import type { DriveChangeBatchRequest } from "@synapse/shared" with { "resolution-mode": "import" }

const binding = (id: string) => ({ id, ownerUserId: "owner", driveItemId: id, remoteCursor: "10", drivePathHint: `/${id}` }) as DriveSyncBindingEntryV1
const page = (cursor: string) => ({ items: [], nextCursor: cursor, hasMore: false, resyncRequired: false })
function account(): DriveSyncBatchAccount {
  return {
    getDriveItemsBatch: vi.fn(async (ids: readonly string[]) => ({ results: ids.map((itemId) => ({ itemId, data: null, error: { status: 404, code: "NOT_FOUND", message: "missing" } })) })),
    listDriveChangesBatch: vi.fn(async (requests: readonly DriveChangeBatchRequest[]) => ({ results: requests.map((r) => ({ requestId: r.requestId, data: page(r.cursor ?? "0"), error: null })) })),
  }
}

describe("Drive sync batch pages", () => {
  it("coalesces continuation pages and isolates per-root failure", async () => {
    const api = account()
    const reads = await prepareDriveSyncBatchReads([binding("a"), binding("b")], api)
    vi.mocked(api.listDriveChangesBatch).mockImplementationOnce(async (requests) => ({ results: requests.map((r) => r.rootItemId === "a"
      ? { requestId: r.requestId, error: null, data: page("15") }
      : { requestId: r.requestId, data: null, error: { status: 429, code: "THROTTLED", message: "wait", retryAfterMs: 90000 } }) }))
    const result = await Promise.allSettled([
      reads.get("a")!.nextPage({ rootItemId: "a", cursor: "15" }),
      reads.get("b")!.nextPage({ rootItemId: "b", cursor: "25" }),
    ])
    expect(api.listDriveChangesBatch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.listDriveChangesBatch).mock.calls[1]?.[0]).toMatchObject([{ rootItemId: "a", cursor: "15" }, { rootItemId: "b", cursor: "25" }])
    expect(result[0]).toEqual({ status: "fulfilled", value: page("15") })
    expect(result[1]).toMatchObject({ status: "rejected", reason: { status: 429, retryAfterMs: 90000 } })
  })

  it("marks missing continuation pages as retryable protocol errors", async () => {
    const api = account()
    const reads = await prepareDriveSyncBatchReads([binding("a")], api)
    vi.mocked(api.listDriveChangesBatch).mockResolvedValueOnce({ results: [] })
    await expect(reads.get("a")!.nextPage({ rootItemId: "a", cursor: "15" })).rejects.toMatchObject({ status: 502 })
  })
})
