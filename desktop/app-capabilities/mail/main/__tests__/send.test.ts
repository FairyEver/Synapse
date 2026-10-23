import { randomUUID } from "node:crypto"
import { expect, it, vi } from "vitest"
import { sendRig } from "./send-fixtures"
import { MailError } from "../../shared/types"
it("freezes From/Bcc and submits a draft revision once across request IDs", async () => {
  const r = await sendRig()
  try {
    const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    expect(preview.from.address).toBe("me@example.com"); expect(preview.draft.bcc[0].address).toBe("hidden@example.com")
    vi.mocked(r.smtp.submit).mockImplementation(async snapshot => { expect(snapshot.raw.toString()).not.toContain("hidden@example.com"); return { accepted: snapshot.to, rejected: [], messageId: snapshot.messageId } })
    const input = { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true as const }
    const [a, b] = await Promise.all([r.send.submit(r.ctx, input), r.send.submit(r.ctx, { ...input, clientRequestId: randomUUID() })])
    expect(a.state).toBe("accepted"); expect(b.operationId).toBe(a.operationId)
    await r.send.submit(r.ctx, input); expect(r.smtp.submit).toHaveBeenCalledTimes(1)
    expect(r.session.append).not.toHaveBeenCalled()
    expect((await r.drafts.get(r.ctx, r.draft.id)).state).toBe("consumed")
  } finally { await r.close() }
})
it("rejects expired previews, changed content and request IDs bound to another draft", async () => {
  const r = await sendRig()
  try {
    const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    const input = { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true as const }
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60_000 + 1)
    await expect(r.send.submit(r.ctx, input)).rejects.toMatchObject({ code: "PREVIEW_EXPIRED" }); expect(r.smtp.submit).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    vi.mocked(r.smtp.submit).mockRejectedValue(new MailError("NETWORK_TIMEOUT", "uncertain"))
    expect((await r.send.submit(r.ctx, input)).state).toBe("unknown")
    const edited = await r.drafts.execute(r.ctx, "draft.update", { draftId: r.draft.id, expectedRevision: r.draft.revision, patch: { subject: "Changed" } })
    const next = await r.send.preview(r.ctx, { draftId: edited.id, expectedRevision: edited.revision })
    await expect(r.send.submit(r.ctx, { ...input, previewId: next.previewId })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
    await expect(r.send.submit(r.ctx, { ...input, clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "PREVIEW_STALE" })
  } finally { vi.restoreAllMocks(); await r.close() }
})
it("keeps partial RCPT outcomes and does not resend accepted recipients", async () => {
  const r = await sendRig()
  try {
    vi.mocked(r.smtp.submit).mockImplementation(async snapshot => ({ accepted: [snapshot.to[0]], rejected: [snapshot.to[1]], messageId: snapshot.messageId }))
    const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    const input = { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true as const }
    const receipt = await r.send.submit(r.ctx, input)
    expect(receipt).toMatchObject({ state: "partial", accepted: ["to@example.com"], rejected: ["hidden@example.com"] })
    await r.send.submit(r.ctx, input); expect(r.smtp.submit).toHaveBeenCalledTimes(1)
  } finally { await r.close() }
})
it("normalizes an interrupted submitting operation to unknown without SMTP replay", async () => {
  const r = await sendRig()
  try {
    const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    vi.mocked(r.smtp.submit).mockRejectedValue(new MailError("NETWORK_TIMEOUT", "uncertain"))
    const receipt = await r.send.submit(r.ctx, { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true })
    const row = await r.repo.get(r.ctx, "operations", receipt.operationId)
    await r.repo.save(r.ctx, "operations", row.id, row.accountId, { ...row.data, state: "submitting", receipt: { ...receipt, state: "submitting" } }, row.revision)
    await r.operations.recover(r.ctx)
    expect((await r.operations.get(r.ctx, { operationId: row.id })).state).toBe("unknown")
    expect(r.smtp.submit).toHaveBeenCalledTimes(1)
  } finally { await r.close() }
})
it("does not use a frozen preview against a changed sending endpoint", async () => {
  const r = await sendRig()
  try {
    const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    await r.accounts.update(r.ctx, { accountId: r.account.id, expectedRevision: r.account.revision, patch: { smtp: { host: "different.example.com", port: 465, security: "tls" } } })
    await r.accounts.inspect(r.ctx, r.account.id)
    await expect(r.send.submit(r.ctx, { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true })).rejects.toMatchObject({ code: "PREVIEW_STALE" })
    expect(r.smtp.submit).not.toHaveBeenCalled()
  } finally { await r.close() }
})
it("recovers a crash after SMTP acceptance but before durable outcome storage without submitting again", async () => {
  const r = await sendRig()
  try {
    const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    const commit = r.storage.commitBatch!.bind(r.storage)
    const interrupted = vi.spyOn(r.storage, "commitBatch").mockImplementation(async request => {
      if (request.operations.some(op => op.namespace === "app.mail.operations" && op.kind === "patch" && /"state":"(?:accepted|unknown)"/u.test(JSON.stringify(op.patch)))) throw new Error("process interrupted")
      return commit(request)
    })
    await expect(r.send.submit(r.ctx, { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true })).rejects.toThrow("process interrupted")
    expect(r.smtp.submit).toHaveBeenCalledTimes(1)
    interrupted.mockRestore()
    await r.operations.recover(r.ctx)
    const list = await r.operations.list(r.ctx, { accountId: r.account.id, limit: 50 })
    expect(list.items).toHaveLength(1); expect(list.items[0].state).toBe("unknown")
    expect(r.smtp.submit).toHaveBeenCalledTimes(1)
  } finally { await r.close() }
})

it("recovers a prepared operation using its persisted MIME despite a later equivalent preview", async () => {
  const r = await sendRig()
  try {
    const a = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    const save = r.repo.save.bind(r.repo)
    const crash = vi.spyOn(r.repo, "save").mockImplementation(async (...args) => {
      if (args[1] === "operations" && args[2].startsWith("request:")) throw new Error("crash after prepare")
      return save(...args)
    })
    await expect(r.send.submit(r.ctx, { previewId: a.previewId, clientRequestId: randomUUID(), confirmed: true })).rejects.toThrow("crash after prepare")
    crash.mockRestore(); expect(r.smtp.submit).not.toHaveBeenCalled()
    const b = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    expect(b.messageId).not.toBe(a.messageId)
    const receipt = await r.send.submit(r.ctx, { previewId: b.previewId, clientRequestId: randomUUID(), confirmed: true })
    const operation = await r.repo.get<import("../send").StoredSend>(r.ctx, "operations", receipt.operationId)
    expect(r.smtp.submit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(r.smtp.submit).mock.calls[0][0].messageId).toBe(a.messageId)
    expect(vi.mocked(r.smtp.submit).mock.calls[0][0].raw).toEqual(await r.assets.read(r.ctx, operation.data.snapshot.rawAssetId))
    expect(receipt.messageId).toBe(a.messageId)
  } finally { await r.close() }
})
