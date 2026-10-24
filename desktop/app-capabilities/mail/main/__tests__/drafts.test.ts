import { expect, it, vi } from "vitest"
import { Readable } from "node:stream"
import { draftRig } from "./draft-fixtures"
import type { StoredFolder } from "../sync"
import { MailSend } from "../send"
import { MailSendOperations } from "../send-reconcile"

it("CAS saves content once and keeps editor revisions independent from sync metadata", async () => {
  const r = await draftRig()
  try {
    const draft = await r.drafts.execute(r.ctx, "draft.create", { accountId: r.account.id, to: [], cc: [], bcc: [], subject: "Draft", html: "<p>first</p>", text: "first", assetIds: [], inlineImages: [] })
    const results = await Promise.allSettled(["A", "B"].map(text => r.drafts.execute(r.ctx, "draft.update", { draftId: draft.id, expectedRevision: draft.revision, patch: { text, html: `<p>${text}</p>` } })))
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
    const stored = await r.repo.get(r.ctx, "drafts", draft.id)
    await r.repo.save(r.ctx, "drafts", draft.id, r.account.id, { ...stored.data, syncState: "failed" }, stored.revision)
    const current = await r.drafts.execute(r.ctx, "draft.get", { draftId: draft.id })
    const next = await r.drafts.execute(r.ctx, "draft.update", { draftId: draft.id, expectedRevision: current.revision, patch: { subject: "next" } })
    expect(next.localSaved).toBe(true); expect(next.revision).toBe(draft.revision + 2)
    expect(JSON.stringify((await r.repo.get(r.ctx, "drafts", draft.id)).data)).not.toContain("<p>")
  } finally { await r.sync.dispose(); await r.close() }
})
it("prefers Reply-To, removes self/duplicates and never copies Bcc into replies", async () => {
  const r = await draftRig()
  try {
    const reply = await r.drafts.execute(r.ctx, "draft.create", { accountId: r.account.id, sourceMessageId: r.source.id, mode: "reply", forwardMode: "inline" })
    expect(reply.to.map(a => a.address)).toEqual(["reply@example.com"]); expect(reply.cc).toEqual([]); expect(reply.bcc).toEqual([])
    const all = await r.drafts.execute(r.ctx, "draft.create", { accountId: r.account.id, sourceMessageId: r.source.id, mode: "reply_all", forwardMode: "inline" })
    expect(all.to.map(a => a.address)).toEqual(["reply@example.com", "other@example.com"]); expect(all.cc.map(a => a.address)).toEqual(["cc@example.com"])
    expect(all.text).toContain("Original text")
    expect((await r.drafts.stored(r.ctx, all.id)).data.headers.inReplyTo).toBe("<1@example.com>")
  } finally { await r.sync.dispose(); await r.close() }
})
it("carries forward attachments or an EML asset while validating owned inline images", async () => {
  const r = await draftRig()
  try {
    vi.mocked(r.session.fetchBodyStructure).mockResolvedValue({ type: "multipart/mixed", childNodes: [{ type: "text/plain", part: "1" }, { type: "application/octet-stream", part: "2", disposition: "attachment", dispositionParameters: { filename: "data.bin" } }] })
    vi.mocked(r.session.fetchPart).mockImplementation(async (_path, _uid, part) => Readable.from([part === "2" ? Buffer.from([1, 2, 3]) : part === undefined ? Buffer.from("From: author@example.com\r\nSubject: Test\r\n\r\nOriginal") : Buffer.from("Original")]))
    const inline = await r.drafts.execute(r.ctx, "draft.create", { accountId: r.account.id, sourceMessageId: r.source.id, mode: "forward", forwardMode: "inline" })
    expect(inline.assetIds).toHaveLength(1); expect((await r.assets.info(r.ctx, inline.assetIds[0])).sha256).toBeTruthy()
    const eml = await r.drafts.execute(r.ctx, "draft.create", { accountId: r.account.id, sourceMessageId: r.source.id, mode: "forward", forwardMode: "eml" })
    expect(eml.assetIds).toHaveLength(1); expect((await r.assets.info(r.ctx, eml.assetIds[0])).mime).toBe("message/rfc822")
    await r.assets.pin(r.ctx, eml.assetIds[0], 1); await r.drafts.recover(r.ctx)
    expect((await r.repo.get(r.ctx, "assets", eml.assetIds[0])).data.pins).toBe(1)
  } finally { await r.sync.dispose(); await r.close() }
})
it("indexes remote drafts without downloading bodies and hydrates the original editable snapshot on open", async () => {
  const r = await draftRig()
  try {
    const folderId = (r.source.data.summary as { locator: { folderId: string } }).locator.folderId
    const folder = await r.repo.get<StoredFolder>(r.ctx, "folders", folderId)
    await r.repo.save(r.ctx, "folders", folderId, r.account.id, { ...folder.data, folder: { ...folder.data.folder, role: "drafts" } }, folder.revision, folder.sortKey)
    vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from(["From: me@example.com\r\nTo: Team: Alice <alice@example.com>, Bob <bob@example.com>;\r\nCc: Reviewers: Carol <carol@example.com>;\r\nBcc: Hidden: hidden@example.com;\r\nSubject: Remote\r\nMessage-ID: <remote@example.com>\r\n\r\nEditable original"]))
    const id = await r.drafts.indexRemote(r.ctx, r.source.id)
    expect(r.session.fetchPart).not.toHaveBeenCalled()
    const draft = await r.drafts.execute(r.ctx, "draft.get", { draftId: id! })
    expect(draft.text).toContain("Editable original"); expect(draft.bcc[0].address).toBe("hidden@example.com")
    expect(draft.localSaved).toBe(true); expect(draft.remoteLocator).toMatchObject({ uid: 1 })
    expect(draft.to.map(address => address.address)).toEqual(["alice@example.com", "bob@example.com"])
    expect(draft.cc).toEqual([{ address: "carol@example.com", name: "Carol" }])
    const saved = await r.drafts.execute(r.ctx, "draft.update", { draftId: draft.id, expectedRevision: draft.revision, patch: { subject: "Saved remote draft" } })
    const send = new MailSend(r.repo, r.accounts, r.assets, r.drafts, new MailSendOperations(r.repo, r.accounts, r.assets, r.drafts))
    const preview = await send.preview(r.ctx, { draftId: saved.id, expectedRevision: saved.revision })
    expect(preview.draft).toMatchObject({ to: draft.to, cc: draft.cc, bcc: draft.bcc })
    expect(r.smtp.submit).not.toHaveBeenCalled()
  } finally { await r.sync.dispose(); await r.close() }
})

it("prepares a reply without creating a persistent draft and commits edited content explicitly", async () => {
  const r = await draftRig()
  try {
    const source = { accountId: r.account.id, sourceMessageId: r.source.id, mode: "reply" as const, forwardMode: "inline" as const }
    const prepared = await r.drafts.prepare(r.ctx, source)
    expect(prepared.localSaved).toBe(false)
    expect((await r.drafts.execute(r.ctx, "draft.list", { accountId: r.account.id, limit: 100 })).items).toHaveLength(0)
    const { to, cc, bcc, subject, html, text, assetIds, inlineImages } = prepared
    const committed = await r.drafts.commit(r.ctx, { content: { accountId: r.account.id, to, cc, bcc, subject, html, text: `Edited ${text}`, assetIds, inlineImages }, source: { messageId: r.source.id, mode: "reply" } })
    expect(committed.text).toContain("Edited")
    expect((await r.drafts.stored(r.ctx, committed.id)).data.headers.inReplyTo).toBe("<1@example.com>")
    expect((await r.drafts.execute(r.ctx, "draft.list", { accountId: r.account.id, limit: 100 })).items).toHaveLength(1)
  } finally { await r.sync.dispose(); await r.close() }
})

it("protects unsaved compose attachments from cache clearing until their window releases them", async () => {
  const r = await draftRig()
  try {
    const asset = await r.assets.put(r.ctx, Readable.from(["attachment"]), { accountId: r.account.id, name: "a.txt", mime: "text/plain", cache: true })
    await r.assets.hold(r.ctx, "window-1", r.account.id, [asset.id])
    expect((await r.assets.clearCache(r.ctx, r.account.id)).removed).toBe(0)
    r.assets.release("window-1")
    expect((await r.assets.clearCache(r.ctx, r.account.id)).removed).toBe(1)
  } finally { await r.sync.dispose(); await r.close() }
})

it("skips live compose leases while recovering other expired imports", async () => {
  const r = await draftRig()
  try {
    const put = () => r.assets.put(r.ctx, Readable.from(["attachment"]), { accountId: r.account.id, name: "a.txt", mime: "text/plain" })
    const held = await put(), expired = await put()
    await r.assets.hold(r.ctx, "window", r.account.id, [held.id])
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 60 * 60_000)
    expect((await r.assets.recover(r.ctx)).removed).toBe(1)
    expect(await r.assets.info(r.ctx, held.id)).toMatchObject({ state: "ready" })
    await expect(r.assets.info(r.ctx, expired.id)).rejects.toThrow()
  } finally { vi.restoreAllMocks(); await r.sync.dispose(); await r.close() }
})
