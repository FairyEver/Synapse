import { expect, it, vi } from "vitest"
import { Readable } from "node:stream"
import { MailError } from "../../shared/types"
import { MailContent } from "../mime"
import { MailSearch } from "../search"
import { syncRig } from "./sync-fixtures"

for (const code of ["STALE_TARGET", "BODY_UNAVAILABLE", "NETWORK_TIMEOUT"] as const) it(`invalidates a missing remote message only for ${code}`, async () => {
  const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const row = (await r.repo.page<import("../sync").StoredMessage>(r.ctx, "messages", { accountId: r.account.id })).items[0]
    await r.repo.save(r.ctx, "messages", row.id, row.accountId, { ...row.data, structure: { type: "text/plain", part: "1" } }, row.revision, row.sortKey)
    const asset = await r.assets.put(r.ctx, Readable.from([Buffer.from("draft attachment")]), { accountId: row.accountId, messageId: row.id, name: "draft.txt", mime: "text/plain", pinned: true })
    vi.mocked(r.session.fetchPart).mockRejectedValue(new MailError(code, "Unavailable"))
    const changed = vi.fn(), content = new MailContent(r.repo, r.accounts, r.assets, r.access, changed)
    await expect(content.readChunk(r.ctx, { messageId: row.id })).rejects.toMatchObject({ code })
    const search = new MailSearch(r.repo, content.readSearchText)
    const list = await search.listMessages(r.ctx, { accountId: r.account.id, limit: 50 })
    expect(list.items.map(item => item.id)).toEqual(code === "STALE_TARGET" ? [] : [row.id])
    if (code === "STALE_TARGET") expect(changed).toHaveBeenCalledWith(expect.objectContaining({ ownerId: r.ctx.ownerId, generation: r.ctx.generation, accountId: row.accountId, ids: [row.id] }))
    else expect(changed).not.toHaveBeenCalled()
    expect((await r.assets.read(r.ctx, asset.id)).toString()).toBe("draft attachment")
  } finally { await r.sync.dispose(); await r.close() }
})
