import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { expect, it, vi } from "vitest"
import { createMailTestRig } from "./helpers"
import { aliyunConfig } from "../protocol/aliyun-policy"
import { MailDrafts } from "../drafts"
import { MailDraftSync } from "../draft-sync"
import { MailContent } from "../mime"
import type { StoredFolder } from "../sync"
async function setup() {
  const r = await createMailTestRig(), account = await r.accounts.configure(r.ctx, { ...aliyunConfig("me@example.com", "Work"), credential: "secret" })
  const id = `mf_${randomUUID()}`
  await r.repo.save<StoredFolder>(r.ctx, "folders", id, account.id, { folder: { id, accountId: account.id, path: "Drafts", name: "Drafts", role: "drafts", uidValidity: "1", serverCount: 0, metadataComplete: true, selectable: true }, flags: [], delimiter: "/" }, 0)
  const content = new MailContent(r.repo, r.accounts, r.assets, r.access), drafts = new MailDrafts(r.repo, r.accounts, r.assets, content)
  const sync = new MailDraftSync(r.repo, r.accounts, r.assets, drafts)
  const draft = await drafts.execute(r.ctx, "draft.create", { accountId: account.id, to: [{ address: "to@example.com" }], cc: [], bcc: [{ address: "hidden@example.com" }], subject: "Test", html: "<p>original</p>", text: "original", assetIds: [], inlineImages: [] })
  return { ...r, account, drafts, draft, sync }
}
it("does not append again after unknown APPEND and retains the old draft until confirmation", async () => {
  const r = await setup()
  try {
    vi.mocked(r.session.append).mockResolvedValueOnce({ uidValidity: "1", uid: 99 }).mockResolvedValue(null)
    expect((await r.sync.sync(r.ctx, r.draft.id)).syncState).toBe("synced")
    const firstRaw = vi.mocked(r.session.append).mock.calls[0][1]
    vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from([firstRaw]))
    vi.mocked(r.session.searchUids).mockImplementation(async (_path, query) => query.uid ? [99] : [])
    const current = await r.drafts.execute(r.ctx, "draft.get", { draftId: r.draft.id })
    await r.drafts.execute(r.ctx, "draft.update", { draftId: current.id, expectedRevision: current.revision, patch: { text: "second", html: "<p>second</p>" } })
    expect((await r.sync.sync(r.ctx, current.id)).syncState).toBe("unknown")
    expect(r.session.storeFlags).not.toHaveBeenCalled(); expect(r.session.uidExpunge).not.toHaveBeenCalled()
    await r.sync.sync(r.ctx, current.id); expect(r.session.append).toHaveBeenCalledTimes(2)
    expect((await r.drafts.execute(r.ctx, "draft.get", { draftId: current.id })).text).toBe("second")
  } finally { await r.close() }
})
it("preserves a local conflict copy when a remote draft changes", async () => {
  const r = await setup()
  try {
    vi.mocked(r.session.append).mockResolvedValue({ uidValidity: "1", uid: 99 }); await r.sync.sync(r.ctx, r.draft.id)
    const current = await r.drafts.execute(r.ctx, "draft.get", { draftId: r.draft.id })
    await r.drafts.execute(r.ctx, "draft.update", { draftId: current.id, expectedRevision: current.revision, patch: { text: "local edit" } })
    vi.mocked(r.session.searchUids).mockResolvedValue([99])
    vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from(["From: me@example.com\r\nTo: to@example.com\r\nSubject: Server edit\r\n\r\nremote edit"]))
    expect((await r.sync.sync(r.ctx, current.id)).syncState).toBe("conflict")
    expect((await r.drafts.execute(r.ctx, "draft.get", { draftId: current.id })).text).toBe("local edit")
    const list = await r.drafts.execute(r.ctx, "draft.list", { accountId: r.account.id, limit: 50 })
    expect(list.items).toHaveLength(2); expect(r.session.append).toHaveBeenCalledTimes(1)
  } finally { await r.close() }
})
it("persists confirmed APPEND before precise deletion of the old draft", async () => {
  const r = await setup()
  try {
    vi.mocked(r.session.append).mockResolvedValueOnce({ uidValidity: "1", uid: 99 }).mockResolvedValueOnce({ uidValidity: "1", uid: 100 })
    await r.sync.sync(r.ctx, r.draft.id)
    const first = vi.mocked(r.session.append).mock.calls[0][1]
    expect(first.toString()).toMatch(/^Bcc: hidden@example.com$/mu)
    vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from([first]))
    let deleted = false
    vi.mocked(r.session.searchUids).mockImplementation(async (_path, query) => query.uid === "99" && !deleted ? [99] : [])
    vi.mocked(r.session.uidExpunge).mockImplementation(async () => {
      expect(r.session.append).toHaveBeenCalledTimes(2)
      expect((await r.drafts.stored(r.ctx, r.draft.id)).data.pendingAppend?.state).toBe("accepted")
      deleted = true
    })
    const draft = await r.drafts.get(r.ctx, r.draft.id)
    await r.drafts.execute(r.ctx, "draft.update", { draftId: draft.id, expectedRevision: draft.revision, patch: { text: "new" } })
    expect((await r.sync.sync(r.ctx, draft.id)).remoteLocator?.uid).toBe(100)
    expect(r.session.uidExpunge).toHaveBeenCalledWith("Drafts", [99], r.ctx.signal)
  } finally { await r.close() }
})
it("reconciles unknown APPEND only with a unique generated ID and matching complete raw hash", async () => {
  const r = await setup()
  try {
    vi.mocked(r.session.append).mockResolvedValue(null)
    expect((await r.sync.sync(r.ctx, r.draft.id)).syncState).toBe("unknown")
    const attempt = (await r.drafts.stored(r.ctx, r.draft.id)).data.pendingAppend!
    const raw = vi.mocked(r.session.append).mock.calls[0][1]
    vi.mocked(r.session.searchUids).mockResolvedValue([99])
    vi.mocked(r.session.fetchHeaders).mockResolvedValue([{ uid: 99, subject: "Test", from: [], to: [], cc: [], replyTo: [], date: null, size: raw.length, flags: [], messageId: attempt.messageId, references: [], structure: null }])
    vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from([raw]))
    expect((await r.sync.sync(r.ctx, r.draft.id)).syncState).toBe("synced")
    expect(r.session.append).toHaveBeenCalledTimes(1)
  } finally { await r.close() }
})
