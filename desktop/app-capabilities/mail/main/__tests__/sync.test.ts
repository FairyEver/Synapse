import { afterEach, describe, expect, it, vi } from "vitest"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { MailError } from "../../shared/types"
import { aliyunConfig } from "../protocol/aliyun-policy"

describe("mail metadata synchronization", () => {
  const close: (() => Promise<void>)[] = []
  afterEach(async () => { vi.useRealTimers(); for (const fn of close.splice(0)) await fn() })
  it("indexes first 50 then bounded 100-header batches without fetching bodies; repeated hints are idempotent", async () => {
    const r = await syncRig(); close.push(async () => { await r.sync.dispose(); await r.close() })
    await r.sync.runOnce(r.ctx, r.account.id)
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
    await r.sync.runOnce(r.ctx, r.account.id)
    await r.sync.runOnce(r.ctx, r.account.id)
    expect(r.delta).toHaveBeenCalledTimes(1)
    expect(r.delta.mock.calls[0][1].messages.map((m: { locator: { uid: number } }) => m.locator.uid)).toEqual([252])
    await r.sync.runOnce(r.ctx, r.account.id); expect(r.delta).toHaveBeenCalledTimes(1)
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
