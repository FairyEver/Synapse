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
