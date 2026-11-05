import { randomUUID } from "node:crypto"
import { expect, it, vi } from "vitest"
import { sendRig } from "./send-fixtures"
import { MailError } from "../../shared/types"
it("repairs a definitely rejected client Sent append without repeating SMTP", async () => {
  const r = await sendRig(true)
  try {
    vi.mocked(r.smtp.submit).mockImplementation(async snapshot => ({ accepted: snapshot.to, rejected: [], messageId: snapshot.messageId }))
    vi.mocked(r.session.append).mockRejectedValueOnce(new MailError("APPEND_FAILED", "rejected", { definitelyNotSubmitted: true })).mockResolvedValue({ uidValidity: "1", uid: 7 })
    const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    const input = { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true as const }
    const first = await r.send.submit(r.ctx, input)
    expect(first).toMatchObject({ state: "accepted", sentCopyState: "failed", retryStage: "sent-copy" })
    await r.operations.get(r.ctx, { operationId: first.operationId })
    expect(r.session.append).toHaveBeenCalledTimes(1)
    const receipt = await r.send.submit(r.ctx, input)
    expect(receipt.sentCopyState).toBe("saved"); expect(r.smtp.submit).toHaveBeenCalledTimes(1); expect(r.session.append).toHaveBeenCalledTimes(2)
  } finally { await r.close() }
})
it("does not blindly append an unknown client Sent copy or treat absence as unsent", async () => {
  const r = await sendRig(true)
  try {
    vi.mocked(r.smtp.submit).mockImplementation(async snapshot => ({ accepted: snapshot.to, rejected: [], messageId: snapshot.messageId }))
    vi.mocked(r.session.append).mockResolvedValue(null)
    const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    const input = { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true as const }
    const receipt = await r.send.submit(r.ctx, input)
    expect(receipt.sentCopyState).toBe("unknown")
    await r.send.submit(r.ctx, input); await r.operations.get(r.ctx, { operationId: receipt.operationId })
    expect(r.session.append).toHaveBeenCalledTimes(1); expect(r.smtp.submit).toHaveBeenCalledTimes(1)
  } finally { await r.close() }
})
it("requires the full content fingerprint and does not invent missing recipient outcomes from Sent", async () => {
  const { Readable } = await import("node:stream")
  const r = await sendRig()
  try {
    vi.mocked(r.smtp.submit).mockRejectedValue(new MailError("NETWORK_TIMEOUT", "unknown"))
    const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
    const receipt = await r.send.submit(r.ctx, { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true })
    const operation = await r.repo.get<import("../send").StoredSend>(r.ctx, "operations", receipt.operationId)
    const raw = vi.mocked(r.smtp.submit).mock.calls[0][0].raw
    vi.mocked(r.session.searchUids).mockResolvedValue([7])
    vi.mocked(r.session.fetchHeaders).mockResolvedValue([{ uid: 7, subject: "Hello", from: [{ address: "me@example.com" }], to: [], cc: [], replyTo: [], date: operation.data.snapshot.createdAt, size: raw.length, flags: [], messageId: preview.messageId, references: [], structure: null }])
    vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from([Buffer.from(raw.toString().replaceAll("Frozen content", "Other content"))]))
    expect((await r.operations.get(r.ctx, { operationId: receipt.operationId })).sentCopyState).not.toBe("saved")
    vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from([raw]))
    expect(await r.operations.get(r.ctx, { operationId: receipt.operationId })).toMatchObject({ state: "unknown", sentCopyState: "saved", accepted: [], rejected: [], errorCode: "RECIPIENT_OUTCOME_UNKNOWN" })
    expect(r.smtp.submit).toHaveBeenCalledTimes(1); expect(r.session.append).not.toHaveBeenCalled()
  } finally { await r.close() }
})

it("reconciles a plain-text Sent copy missing only the final wire CRLF without resending", async () => {
  const { Readable } = await import("node:stream")
  const r = await sendRig()
  try {
    const draft = await r.drafts.execute(r.ctx, "draft.create", { accountId: r.account.id, to: [{ address: "to@example.com" }], cc: [], bcc: [], subject: "Plain text", html: "", text: "Automation pause recovery test with a long ASCII line\n第二行 中文 🧪\n\n{{literal}}\n最后一行", assetIds: [], inlineImages: [] })
    vi.mocked(r.smtp.submit).mockImplementation(async snapshot => ({ accepted: snapshot.to, rejected: [], messageId: snapshot.messageId }))
    const preview = await r.send.preview(r.ctx, { draftId: draft.id, expectedRevision: draft.revision })
    const receipt = await r.send.submit(r.ctx, { previewId: preview.previewId, clientRequestId: randomUUID(), confirmed: true })
    const raw = vi.mocked(r.smtp.submit).mock.calls[0][0].raw
    expect(raw.toString()).toContain("Content-Transfer-Encoding: quoted-printable")
    expect(raw.subarray(-2).toString()).toBe("\r\n")
    const operation = await r.repo.get<import("../send").StoredSend>(r.ctx, "operations", receipt.operationId)
    vi.mocked(r.session.searchUids).mockResolvedValue([7])
    vi.mocked(r.session.fetchHeaders).mockResolvedValue([{ uid: 7, subject: "Plain text", from: [{ address: "me@example.com" }], to: [], cc: [], replyTo: [], date: operation.data.snapshot.createdAt, size: raw.length - 2, flags: [], messageId: preview.messageId, references: [], structure: null }])
    const saved = raw.subarray(0, -2)
    vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from([saved]))
    expect(await r.operations.get(r.ctx, { operationId: receipt.operationId })).toMatchObject({ state: "accepted", sentCopyState: "saved", retryStage: "none" })
    expect(r.smtp.submit).toHaveBeenCalledTimes(1)
    expect(r.session.append).not.toHaveBeenCalled()
  } finally { await r.close() }
})

it.each(["\r\n", " ", "CHANGED"])("still rejects a changed plain-text body (%j)", async (change) => {
  const { Readable } = await import("node:stream")
  const { mimeFingerprint } = await import("../send")
  const r = await sendRig()
  try {
    const headers = "From: me@example.com\r\nTo: to@example.com\r\nSubject: Test\r\nDate: Thu, 05 Nov 2026 20:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n"
    const original = Buffer.from(`${headers}First\r\n\r\nLast\r\n`)
    const changed = Buffer.from(`${headers}First\r\n\r\nLast${change}\r\n`)
    expect(await mimeFingerprint(r.ctx, changed)).not.toBe(await mimeFingerprint(r.ctx, original))
    const { parseMailStream } = await import("../mime")
    expect((await parseMailStream(Readable.from([original]), { signal: r.ctx.signal })).text).toBe("First\n\nLast\n")
  } finally { await r.close() }
})
