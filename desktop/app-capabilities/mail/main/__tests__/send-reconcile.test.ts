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
