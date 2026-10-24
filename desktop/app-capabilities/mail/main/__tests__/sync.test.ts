import { afterEach, describe, expect, it, vi } from "vitest"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { MailError } from "../../shared/types"
import { aliyunConfig } from "../protocol/aliyun-policy"

async function completeSync(r: Awaited<ReturnType<typeof syncRig>>) {
  for (let i = 0; i < 100; i++) {
    const coverage = await r.sync.runOnce(r.ctx, r.account.id)
    if (coverage.metadataComplete) return coverage
  }
  throw new Error("Metadata did not finish within bounded cycles")
}

describe("mail metadata synchronization", () => {
  const close: (() => Promise<void>)[] = []
  afterEach(async () => { vi.useRealTimers(); for (const fn of close.splice(0)) await fn() })
  it("reconciles removed drafts before Inbox history finishes, releasing each bounded turn", async () => {
    const r = await syncRig(); close.push(async () => { await r.sync.dispose(); await r.close() })
    vi.mocked(r.session.close).mockClear()
    vi.mocked(r.session.listFolders).mockResolvedValue([
      { path: "INBOX", name: "INBOX", delimiter: "/", flags: [], specialUse: null, count: 251 },
      { path: "Drafts", name: "Drafts", delimiter: "/", flags: [], specialUse: "\\Drafts", count: 2 },
    ])
    let draftUids = [1, 2]
    vi.mocked(r.session.searchUids).mockImplementation(async path => path === "Drafts" ? draftUids : Array.from({ length: 251 }, (_, i) => i + 1))
    await r.sync.runOnce(r.ctx, r.account.id)
    await r.sync.runOnce(r.ctx, r.account.id, undefined, false)
    const folders = (await r.repo.page<import("../sync").StoredFolder>(r.ctx, "folders", { accountId: r.account.id })).items
    const drafts = folders.find(f => f.data.folder.role === "drafts")!
    expect(folders.find(f => f.data.folder.role === "inbox")!.data.folder.metadataComplete).toBe(false)
    const messages = (await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id, limit: 100 })).items
    expect(messages.filter(m => m.data.summary.locator.folderId === drafts.id)).toHaveLength(2)
    draftUids = [2]
    await r.sync.runOnce(r.ctx, r.account.id)
    await r.sync.runOnce(r.ctx, r.account.id, undefined, false)
    const old = await r.repo.get<import("../sync").StoredMessage>(r.ctx, "messages", messages.find(m => m.data.summary.locator.folderId === drafts.id && m.data.summary.locator.uid === 1)!.id)
    expect(old.data.summary.stale).toBe(true)
    expect(r.session.close).toHaveBeenCalledTimes(4)
    expect(vi.mocked(r.session.fetchHeaders).mock.calls.map(call => call[1].length)).toEqual([50, 2, 100])
  })
  it("gives other folders a turn after an Inbox batch fails", async () => {
    const r = await syncRig(); close.push(async () => { await r.sync.dispose(); await r.close() })
    vi.mocked(r.session.listFolders).mockResolvedValue([
      { path: "INBOX", name: "INBOX", delimiter: "/", flags: [], specialUse: null, count: 251 },
      { path: "Drafts", name: "Drafts", delimiter: "/", flags: [], specialUse: "\\Drafts", count: 1 },
    ])
    vi.mocked(r.session.searchUids).mockImplementation(async path => path === "Drafts" ? [1] : Array.from({ length: 251 }, (_, i) => i + 1))
    vi.mocked(r.session.fetchHeaders).mockRejectedValueOnce(new MailError("NETWORK_TIMEOUT", "Timeout"))
    await expect(r.sync.runOnce(r.ctx, r.account.id)).rejects.toMatchObject({ code: "NETWORK_TIMEOUT" })
    await r.sync.runOnce(r.ctx, r.account.id)
    const rows = (await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id, limit: 100 })).items
    expect(rows).toHaveLength(1)
    const folder = await r.repo.get<import("../sync").StoredFolder>(r.ctx, "folders", rows[0].data.summary.locator.folderId)
    expect(folder.data.folder.role).toBe("drafts")
  })
  it("indexes first 50 then bounded 100-header batches without fetching bodies; repeated hints are idempotent", async () => {
    const r = await syncRig(); close.push(async () => { await r.sync.dispose(); await r.close() })
    await completeSync(r)
    expect(vi.mocked(r.session.fetchHeaders).mock.calls.map(c => c[1].length)).toEqual([50, 100, 100, 1])
    expect(r.session.fetchPart).not.toHaveBeenCalled()
    expect(r.delta).not.toHaveBeenCalled()
    await r.sync.runOnce(r.ctx, r.account.id)
    expect(r.session.fetchHeaders).toHaveBeenCalledTimes(4)
    expect((await r.repo.page(r.ctx, "messages", { accountId: r.account.id, limit: 100 })).items).toHaveLength(100)
    expect(r.changed.mock.calls.every(([event]) => !JSON.stringify(event).includes("subject"))).toBe(true)
  })
  it("retains local targets after an incomplete UID query and reconciles complete deletions/flags", async () => {
    const r = await syncRig(); close.push(async () => { await r.sync.dispose(); await r.close() })
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2]); await r.sync.runOnce(r.ctx, r.account.id)
    vi.mocked(r.session.searchUids).mockRejectedValueOnce(new MailError("SEARCH_INCOMPLETE", "Incomplete"))
    await expect(r.sync.runOnce(r.ctx, r.account.id)).rejects.toMatchObject({ code: "SEARCH_INCOMPLETE" })
    expect((await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items.every(m => !(m.data.summary as { stale: boolean }).stale)).toBe(true)
    vi.mocked(r.session.searchUids).mockResolvedValue([2]); vi.mocked(r.session.fetchFlags).mockResolvedValue([{ uid: 2, flags: ["\\Seen", "\\Flagged"] }])
    await r.sync.runOnce(r.ctx, r.account.id)
    const summaries = (await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items.map(m => m.data.summary)
    expect(summaries).toEqual(expect.arrayContaining([expect.objectContaining({ stale: true }), expect.objectContaining({ read: true, star: true })]))
  })
  it("notifies a new UID arriving during history catch-up only after the persisted baseline", async () => {
    const r = await syncRig(); close.push(async () => { await r.sync.dispose(); await r.close() })
    let arrived = false
    vi.mocked(r.session.searchUids).mockImplementation(async () => Array.from({ length: arrived ? 252 : 251 }, (_, i) => i + 1))
    vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => {
      if (uids.length === 100) arrived = true
      return uids.map(uid => ({ ...remoteHeader(uid), date: "invalid date" }))
    })
    await completeSync(r)
    await completeSync(r)
    expect(r.delta).toHaveBeenCalledTimes(1)
    expect(r.delta.mock.calls[0][1].messages.map((m: { locator: { uid: number } }) => m.locator.uid)).toEqual([252])
    await completeSync(r); expect(r.delta).toHaveBeenCalledTimes(1)
  })
  it("limits concurrent history work to two accounts", async () => {
    const r = await syncRig(); close.push(async () => { await r.sync.dispose(); await r.close() })
    const accounts = [r.account]
    for (let i = 0; i < 2; i++) accounts.push(await r.accounts.configure(r.ctx, { ...aliyunConfig(`me${i}@example.com`, "Work"), credential: "secret" }))
    const gates: (() => void)[] = []
    let started = 0
    vi.mocked(r.session.searchUids).mockImplementation(async () => { started++; await new Promise<void>(resolve => gates.push(resolve)); return [] })
    const tasks = accounts.map(a => r.sync.runOnce(r.ctx, a.id))
    await vi.waitFor(() => expect(started).toBe(2))
    gates.shift()!(); await vi.waitFor(() => expect(started).toBe(3))
    for (const release of gates) release()
    await Promise.all(tasks)
  })
  it("polls at 60 seconds, refreshes folders at five minutes, and stops retries on authentication failure", async () => {
    vi.useFakeTimers(); const r = await syncRig(); close.push(async () => { await r.sync.dispose(); await r.close() })
    vi.mocked(r.session.searchUids).mockResolvedValue([])
    vi.mocked(r.session.idle).mockImplementation(async (_path, signal) => new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true })))
    await r.sync.startAccount(r.ctx, r.account.id); await vi.advanceTimersByTimeAsync(0)
    expect(r.session.listFolders).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000); expect(r.session.searchUids).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(240_000); expect(r.session.listFolders).toHaveBeenCalledTimes(2)
    vi.mocked(r.protocols.imap).mockRejectedValue(new MailError("AUTH_FAILED", "Bad credentials"))
    await vi.advanceTimersByTimeAsync(60_000); const attempts = vi.mocked(r.protocols.imap).mock.calls.length
    await vi.advanceTimersByTimeAsync(600_000); expect(r.protocols.imap).toHaveBeenCalledTimes(attempts)
    expect((await r.accounts.get(r.ctx, r.account.id)).state).toBe("auth_failed")
  })
})
it("marks messages stale when a complete folder listing reports their folder removed", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    vi.mocked(r.session.listFolders).mockResolvedValue([]); await r.sync.runOnce(r.ctx, r.account.id)
    expect((await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items[0].data.summary).toMatchObject({ stale: true })
  } finally { await r.sync.dispose(); await r.close() }
})
it("releases the work connection and account queue after the first header batch for foreground operations", async () => {
  const r = await syncRig()
  try {
    const progress = await r.sync.runOnce(r.ctx, r.account.id)
    expect(progress.metadataComplete).toBe(false)
    expect(r.session.fetchHeaders).toHaveBeenCalledTimes(1)
    expect(vi.mocked(r.session.fetchHeaders).mock.calls[0][1]).toHaveLength(50)
    const foreground = vi.fn()
    await r.accounts.exclusive(r.ctx, r.account.id, async () => { foreground(); expect(r.session.close).toHaveBeenCalled() })
    expect(foreground).toHaveBeenCalledTimes(1)
    await r.sync.runOnce(r.ctx, r.account.id)
    expect(vi.mocked(r.session.fetchHeaders).mock.calls[1][1]).toHaveLength(100)
  } finally { await r.sync.dispose(); await r.close() }
})
it("restores online state after a transient connection failure is repaired", async () => {
  const r = await syncRig()
  try {
    const row = await r.repo.get(r.ctx, "accounts", r.account.id)
    await r.repo.save(r.ctx, "accounts", row.id, row.id, { ...row.data, state: "offline", errorCode: "NETWORK_ERROR" }, row.revision)
    vi.mocked(r.session.searchUids).mockResolvedValue([1])
    await r.sync.runOnce(r.ctx, r.account.id)
    expect(await r.accounts.get(r.ctx, r.account.id)).toMatchObject({ state: "connected", errorCode: null })
  } finally { await r.sync.dispose(); await r.close() }
})
it("can stop history while continuing to index and notify new Inbox mail", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue(Array.from({ length: 151 }, (_, i) => i + 1))
    await r.sync.runOnce(r.ctx, r.account.id)
    const first = vi.mocked(r.session.fetchHeaders).mock.calls.length
    await r.sync.runOnce(r.ctx, r.account.id, undefined, false, true)
    expect(r.session.fetchHeaders).toHaveBeenCalledTimes(first)
    vi.mocked(r.session.searchUids).mockResolvedValue(Array.from({ length: 152 }, (_, i) => i + 1))
    await r.sync.runOnce(r.ctx, r.account.id, undefined, false, true)
    expect(vi.mocked(r.session.fetchHeaders).mock.calls.at(-1)?.[1]).toEqual([152])
    expect(r.delta).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ baseline: false, messages: [expect.objectContaining({ locator: expect.objectContaining({ uid: 152 }) })] }))
  } finally { await r.sync.dispose(); await r.close() }
})
it("keeps indexing when a message has an excessively nested MIME structure", async () => {
  const r = await syncRig()
  try {
    let structure: import("../protocol/types").MailBodyStructure = { type: "application/octet-stream", part: "1", disposition: "attachment" }
    for (let depth = 0; depth < 10000; depth++) structure = { type: "multipart/mixed", childNodes: [structure] }
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2]); vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({ ...remoteHeader(uid), structure: uid === 2 ? structure : null })))
    const result = await r.sync.runOnce(r.ctx, r.account.id)
    expect(result.indexedCount).toBe(2)
    const page = await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id, limit: 50 })
    expect(page.items.find(row => row.data.summary.locator.uid === 2)?.data.structure).toBeNull()
  } finally { await r.sync.dispose(); await r.close() }
})
it("isolates oversized message envelopes so following mail continues indexing", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2]); vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({ ...remoteHeader(uid), subject: uid === 2 ? "A".repeat(70_000) : "normal" })))
    expect((await r.sync.runOnce(r.ctx, r.account.id)).indexedCount).toBe(2)
    const page = await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id, limit: 50 })
    const summary = page.items.find(row => row.data.summary.locator.uid === 2)!.data.summary
    expect(summary).toMatchObject({ metadataTruncated: true, from: [], to: [], cc: [] })
    expect(summary.subject.length).toBeLessThan(1000)
  } finally { await r.sync.dispose(); await r.close() }
})
it("keeps malformed envelope addresses from breaking the public message list", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({ ...remoteHeader(uid), from: [{ address: "broken-address" }] })))
    const coverage = await r.sync.runOnce(r.ctx, r.account.id), page = await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id, limit: 50 })
    const { MAIL_RESULT_SCHEMAS } = await import("../../shared/schema")
    expect(MAIL_RESULT_SCHEMAS["message.list"].safeParse({ items: page.items.map(row => ({ ...row.data.summary, revision: row.revision })), nextCursor: null, coverage }).success).toBe(true)
    expect(page.items[0].data.summary).toMatchObject({ metadataTruncated: true, from: [] })
  } finally { await r.sync.dispose(); await r.close() }
})

it("backfills Sender alone while preserving cached mail and never notifying or refetching old mail again", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1])
    await r.sync.runOnce(r.ctx, r.account.id)
    const row = (await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id })).items[0]
    const headers = { ...row.data.headers }; delete headers.sender
    await r.repo.save(r.ctx, "messages", row.id, r.account.id, { ...row.data, headers, searchTextRef: "cached-body" }, row.revision, row.sortKey)
    const sender = [{ name: "作者", address: "relay@example.com" }]
    vi.mocked(r.session.fetchHeaders).mockResolvedValue([{ ...remoteHeader(1), sender }])
    r.delta.mockClear()
    await r.sync.runOnce(r.ctx, r.account.id)
    const saved = await r.repo.get<import("../sync").StoredMessage>(r.ctx, "messages", row.id)
    expect(saved.data.headers.sender).toEqual(sender)
    expect(saved.data.searchTextRef).toBe("cached-body")
    expect(saved.data.summary).toEqual(row.data.summary)
    expect(r.delta).not.toHaveBeenCalled()
    const count = vi.mocked(r.session.fetchHeaders).mock.calls.length
    await r.sync.runOnce(r.ctx, r.account.id)
    expect(r.session.fetchHeaders).toHaveBeenCalledTimes(count)
  } finally { await r.sync.dispose(); await r.close() }
})

it.each([[{ address: "not-an-address" }], Array.from({ length: 101 }, () => ({ address: "relay@example.com" }))])("ignores invalid or oversized Sender metadata without losing recipients", async (...values) => {
  const sender = values as { address: string }[]
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1])
    const to = [{ address: "recipient@example.com", name: "收件人" }]
    vi.mocked(r.session.fetchHeaders).mockResolvedValue([{ ...remoteHeader(1), to, sender }])
    await r.sync.runOnce(r.ctx, r.account.id)
    const row = (await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id })).items[0]
    expect(row.data.headers.sender).toEqual([])
    expect(row.data.summary.to).toEqual(to)
    expect(row.data.summary.metadataTruncated).not.toBe(true)
  } finally { await r.sync.dispose(); await r.close() }
})
