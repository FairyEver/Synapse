import { expect, it, vi } from "vitest"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { MailSearch } from "../search"
import { MAIL_INPUT_SCHEMAS } from "../../shared/schema"
import type { StoredMessage } from "../sync"

async function queryRig() {
  const r = await syncRig()
  vi.mocked(r.session.searchUids).mockResolvedValue([1, 2, 3])
  vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({
    ...remoteHeader(uid),
    from: [{ address: uid === 1 ? "alice@example.com" : "bob@example.com", name: uid === 1 ? "张三" : "李四" }],
    to: [{ address: "me@example.com" }],
    cc: uid === 1 ? [{ address: "team@example.com", name: "项目组" }] : [],
    subject: uid === 1 ? "合同签署" : "张三 alice@example.com 合同",
    date: uid === 1 ? "2026-10-20T00:00:00.000Z" : "2026-10-24T00:00:00.000Z",
    receivedAt: uid === 1 ? "2026-10-24T03:00:00.000Z" : uid === 2 ? "2026-10-24T02:00:00.000Z" : null,
    structure: uid === 1 ? { type: "application/pdf", part: "1", disposition: "attachment", dispositionParameters: { filename: "合同.pdf" } } : { type: "text/plain", part: "1" },
  })))
  await r.sync.runOnce(r.ctx, r.account.id)
  const reader = vi.fn(async () => ({ text: "", bytes: 0, available: false }))
  return { ...r, search: new MailSearch(r.repo, reader), reader }
}

it("combines sender, recipient, subject and attachment conditions without matching names in subjects", async () => {
  const r = await queryRig()
  try {
    const input = MAIL_INPUT_SCHEMAS["message.list"].parse({ accountId: r.account.id, sender: "张三", recipient: "TEAM@EXAMPLE.COM", subject: "合同", hasAttachments: true, attachmentMime: "application/pdf", attachmentName: ".pdf", limit: 1 })
    const page = await r.search.listMessages(r.ctx, input)
    expect(page.items.map(item => item.locator.uid)).toEqual([1])
    const exact = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ accountId: r.account.id, sender: "ALICE@EXAMPLE.COM" }))
    expect(exact.items.map(item => item.locator.uid)).toEqual([1])
    const mismatch = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ accountId: r.account.id, sender: "lice@example.com" }))
    expect(mismatch.items).toEqual([])
    expect(r.reader).not.toHaveBeenCalled()
    expect(r.session.fetchPart).not.toHaveBeenCalled()
  } finally { await r.search.dispose(); await r.sync.dispose(); await r.close() }
})

it("orders received mail by server arrival and filters it independently of the sender's date", async () => {
  const r = await queryRig()
  try {
    const page = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ accountId: r.account.id, receivedAfter: "2026-10-24T00:00:00Z", receivedBefore: "2026-10-25T00:00:00Z" }))
    expect(page.items.map(item => item.locator.uid)).toEqual([1, 2])
    expect(page.items[0].date).toBe("2026-10-20T00:00:00.000Z")
    expect(page.coverage.reason).toContain("received_time_unavailable")
    const exclusiveEnd = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ accountId: r.account.id, receivedBefore: "2026-10-24T03:00:00Z" }))
    expect(exclusiveEnd.items.map(item => item.locator.uid)).toEqual([2])
  } finally { await r.search.dispose(); await r.sync.dispose(); await r.close() }
})

it("uses the same semantic filters in count and search and binds pagination to them", async () => {
  const r = await queryRig()
  try {
    const filter = { accountId: r.account.id, sender: "bob@example.com", hasAttachments: false }
    const page = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ ...filter, limit: 1 }))
    expect(page.nextCursor).toBeTruthy()
    await expect(r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ ...filter, sender: "alice@example.com", limit: 1, cursor: page.nextCursor }))).rejects.toMatchObject({ code: "CURSOR_EXPIRED" })
    const count = await r.search.countMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.count"].parse(filter))
    expect(count.indexed).toBe(2)
    expect(count.serverReported).toBeNull()
    const job = await r.search.execute(r.ctx, "search.start", MAIL_INPUT_SCHEMAS["search.start"].parse({ ...filter, query: "合同" }))
    await r.search.settle()
    const found = await r.search.execute(r.ctx, "search.get", { ...job, limit: 20 })
    expect(found.items.map(item => item.locator.uid).sort()).toEqual([2, 3])
  } finally { await r.search.dispose(); await r.sync.dispose(); await r.close() }
})

it("discloses missing attachment metadata instead of claiming a complete negative search", async () => {
  const r = await queryRig()
  try {
    const rows = await r.repo.page<StoredMessage>(r.ctx, "messages", { accountId: r.account.id, limit: 100 })
    const row = rows.items.find(item => item.data.summary.locator.uid === 1)!
    await r.repo.save(r.ctx, "messages", row.id, row.accountId, { ...row.data, structure: null }, row.revision, row.sortKey)
    const page = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ accountId: r.account.id, attachmentMime: "application/pdf" }))
    expect(page.items).toEqual([])
    expect(page.coverage.reason).toContain("attachment_metadata_unavailable")
  } finally { await r.search.dispose(); await r.sync.dispose(); await r.close() }
})

it("backfills arrival times in bounded sync batches without replacing IDs, bodies or notifying old mail", async () => {
  const r = await queryRig()
  try {
    const rows = await r.repo.page<StoredMessage>(r.ctx, "messages", { accountId: r.account.id, limit: 100 })
    for (const row of rows.items) {
      const summary = { ...row.data.summary }
      delete (summary as Record<string, unknown>).receivedAt
      await r.repo.save(r.ctx, "messages", row.id, row.accountId, { ...row.data, summary, searchTextRef: "preserve-cache" }, row.revision, row.sortKey)
    }
    r.delta.mockClear()
    await r.sync.runOnce(r.ctx, r.account.id)
    const after = await r.repo.page<StoredMessage>(r.ctx, "messages", { accountId: r.account.id, limit: 100 })
    expect(after.items.map(row => row.id).sort()).toEqual(rows.items.map(row => row.id).sort())
    expect(after.items.every(row => "receivedAt" in row.data.summary && row.data.searchTextRef === "preserve-cache")).toBe(true)
    expect(r.delta).not.toHaveBeenCalled()
    const calls = vi.mocked(r.session.fetchHeaders).mock.calls.length
    await r.sync.runOnce(r.ctx, r.account.id)
    expect(r.session.fetchHeaders).toHaveBeenCalledTimes(calls)
  } finally { await r.search.dispose(); await r.sync.dispose(); await r.close() }
})

it("rejects reversed arrival ranges and documents the difference between addresses and dates", () => {
  expect(MAIL_INPUT_SCHEMAS["message.list"].safeParse({ accountId: "ma_e69940c0-4db1-4a0a-8f87-9027d116e194", receivedAfter: "2026-10-25T00:00:00Z", receivedBefore: "2026-10-24T00:00:00Z" }).success).toBe(false)
})
