import { expect, it, vi } from "vitest"
import { syncRig } from "./sync-fixtures"
import { resolveMessage } from "../sync"
it("invalidates old references after UIDVALIDITY changes instead of reusing the same UID", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const old = (await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items[0]
    vi.mocked(r.session.select).mockResolvedValue({ uidValidity: "2", count: 1, uidNext: 2 })
    await r.sync.runOnce(r.ctx, r.account.id)
    await expect(resolveMessage(r.repo, r.ctx, old.id)).rejects.toMatchObject({ code: "STALE_TARGET" })
    const rows = await r.repo.page(r.ctx, "messages", { accountId: r.account.id })
    expect(rows.items).toHaveLength(2); expect(new Set(rows.items.map(m => m.id)).size).toBe(2)
  } finally { await r.sync.dispose(); await r.close() }
})
it("does not reuse a locator when a configured IMAP server changes but UID values are identical", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const old = (await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items[0]
    await r.accounts.update(r.ctx, { accountId: r.account.id, expectedRevision: r.account.revision, patch: { imap: { host: "other.example.com", port: 993, security: "tls" } } })
    await r.accounts.inspect(r.ctx, r.account.id)
    await r.sync.runOnce(r.ctx, r.account.id)
    await expect(resolveMessage(r.repo, r.ctx, old.id)).rejects.toMatchObject({ code: "STALE_TARGET" })
    const current = (await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items.filter(row => !(row.data.summary as { stale: boolean }).stale)
    expect(current).toHaveLength(1); expect(current[0].id).not.toBe(old.id)
  } finally { await r.sync.dispose(); await r.close() }
})
it("keeps rebind recovery mandatory after interrupted index invalidation, even if connection inspection succeeds", async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const commit = r.storage.commitBatch!.bind(r.storage)
    let fail = true
    vi.spyOn(r.storage, "commitBatch").mockImplementation(async request => {
      if (fail && request.operations.some(op => op.namespace === "app.mail.folders")) { fail = false; throw new Error("rebind interrupted") }
      return commit(request)
    })
    await expect(r.accounts.update(r.ctx, { accountId: r.account.id, expectedRevision: r.account.revision, patch: { imap: { host: "different.example.com", port: 993, security: "tls" } } })).rejects.toThrow("rebind interrupted")
    await r.accounts.inspect(r.ctx, r.account.id)
    await expect(r.accounts.credential(r.ctx, r.account.id)).rejects.toMatchObject({ code: "ACCOUNT_REINDEX_REQUIRED" })
    await r.accounts.recover(r.ctx)
    await expect(r.accounts.credential(r.ctx, r.account.id)).resolves.toMatchObject({ config: { imap: { host: "different.example.com" } } })
  } finally { await r.sync.dispose(); await r.close() }
})
