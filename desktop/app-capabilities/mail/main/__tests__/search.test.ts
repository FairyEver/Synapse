import { expect, it, vi } from "vitest"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { MailSearch } from "../search"
import { MailError } from "../../shared/types"

it("normalizes Unicode and case locally, paginates stably, and binds cursors to filters and identity", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2, 3]); vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({ ...remoteHeader(uid), subject: "ＡＢＣ 中文标题" })))
    await r.sync.runOnce(r.ctx, r.account.id)
    const reader = vi.fn(async () => ({ text: "", bytes: 0, available: false }))
    const search = new MailSearch(r.repo, reader)
    const first = await search.listMessages(r.ctx, { accountId: r.account.id, limit: 1 })
    expect(first.nextCursor).toBeTruthy()
    await expect(search.listMessages(r.ctx, { accountId: r.account.id, limit: 1, unreadOnly: true, cursor: first.nextCursor! })).rejects.toMatchObject({ code: "CURSOR_EXPIRED" })
    const job = await search.execute(r.ctx, "search.start", { accountId: r.account.id, query: "abc 中文", fields: "metadata" }); await search.settle()
    const results = await search.execute(r.ctx, "search.get", { ...job, limit: 1 })
    expect(results.items).toHaveLength(1); expect(results.coverage.serverHistoryComplete).toBeNull()
    expect(r.session.searchUids).toHaveBeenCalledTimes(1)
    const next = await search.execute(r.ctx, "search.get", { ...job, limit: 1, cursor: results.nextCursor! })
    expect(next.items[0].id).not.toBe(results.items[0].id)
    r.setOwner("other")
    await expect(search.execute(r.context.current("ui"), "search.get", { ...job, limit: 1 })).rejects.toMatchObject({ code: "UNAVAILABLE" })
  } finally { await r.sync.dispose(); await r.close() }
})
it("reports partial body coverage, resumes only on request, and preserves found items on cancellation", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2]); await r.sync.runOnce(r.ctx, r.account.id)
    const reader = vi.fn(async (_ctx, _id, options) => options.cachedOnly ? { text: "", bytes: 0, available: false } : { text: "需要查找的内容", bytes: 24, available: true })
    const search = new MailSearch(r.repo, reader)
    const job = await search.execute(r.ctx, "search.start", { accountId: r.account.id, query: "查找", fields: "body" }); await search.settle()
    const before = await search.execute(r.ctx, "search.get", { ...job, limit: 50 })
    expect(before.items).toHaveLength(0); expect(before.canContinue).toBe(true)
    expect(before.coverage.reason).toBeTruthy(); expect(before.coverage.serverHistoryComplete).toBeNull()
    const reads = reader.mock.calls.length
    await search.execute(r.ctx, "search.get", { ...job, limit: 50 }); expect(reader).toHaveBeenCalledTimes(reads)
    await search.execute(r.ctx, "search.resume", job); await search.settle()
    expect((await search.execute(r.ctx, "search.get", { ...job, limit: 50 })).items).toHaveLength(2)
    await search.execute(r.ctx, "search.cancel", job)
    expect((await search.execute(r.ctx, "search.get", { ...job, limit: 50 })).items).toHaveLength(2)
    expect(reader.mock.calls.filter(c => !c[2].cachedOnly)).toHaveLength(2)
  } finally { await r.sync.dispose(); await r.close() }
})
it("expires tasks and marks changed index coverage without claiming a snapshot", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const search = new MailSearch(r.repo, async () => { throw new MailError("NETWORK_ERROR", "offline") })
    const list = await search.listMessages(r.ctx, { accountId: r.account.id, limit: 1 })
    const job = await search.execute(r.ctx, "search.start", { accountId: r.account.id, query: "missing", fields: "metadata" }); await search.settle()
    await r.sync.runOnce(r.ctx, r.account.id)
    const result = await search.execute(r.ctx, "search.get", { ...job, limit: 50 }); expect(result.coverage.reason).toContain("index_changed")
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 60 * 60_000 + 1)
    await expect(search.execute(r.ctx, "search.get", { ...job, limit: 50 })).rejects.toMatchObject({ code: "CURSOR_EXPIRED" })
    await expect(search.listMessages(r.ctx, { accountId: r.account.id, limit: 1, cursor: list.nextCursor! })).rejects.toMatchObject({ code: "CURSOR_EXPIRED" })
  } finally { vi.restoreAllMocks(); await r.sync.dispose(); await r.close() }
})
it("does not download already scanned cached bodies again when resuming remote scanning", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2]); await r.sync.runOnce(r.ctx, r.account.id)
    let cached: string | undefined
    const reader = vi.fn(async (_ctx, id, options) => {
      cached ??= id
      return options.cachedOnly && id !== cached ? { text: "", bytes: 0, available: false } : { text: "hit", bytes: 3, available: true }
    })
    const search = new MailSearch(r.repo, reader)
    const job = await search.execute(r.ctx, "search.start", { accountId: r.account.id, query: "hit", fields: "body" }); await search.settle()
    await search.execute(r.ctx, "search.resume", job); await search.settle()
    expect(reader.mock.calls.filter(call => !call[2].cachedOnly).map(call => call[1])).not.toContain(cached)
    expect((await search.execute(r.ctx, "search.get", { ...job, limit: 50 })).coverage.bodyScannedCount).toBe(2)
  } finally { await r.sync.dispose(); await r.close() }
})
it("rechecks result filters after a message changes and reports the changed index", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const search = new MailSearch(r.repo, async () => ({ text: "", bytes: 0, available: false }))
    const job = await search.execute(r.ctx, "search.start", { accountId: r.account.id, query: "Mail", fields: "metadata", unreadOnly: true }); await search.settle()
    const first = await search.execute(r.ctx, "search.get", { ...job, limit: 50 })
    expect(first.items).toHaveLength(1)
    const row = await r.repo.get<import("../sync").StoredMessage>(r.ctx, "messages", first.items[0].id)
    await r.repo.save(r.ctx, "messages", row.id, row.accountId, { ...row.data, summary: { ...row.data.summary, read: true } }, row.revision, row.sortKey)
    const next = await search.execute(r.ctx, "search.get", { ...job, limit: 50 })
    expect(next.items).toEqual([]); expect(next.coverage.reason).toBe("index_changed")
  } finally { await r.sync.dispose(); await r.close() }
})
