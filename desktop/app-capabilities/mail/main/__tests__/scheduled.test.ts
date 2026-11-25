import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MailError } from "../../shared/types"
import { MailScheduler } from "../scheduled"
import { sendRig } from "./send-fixtures"

async function scheduledRig() {
  const base = await sendRig()
  const changed = vi.fn()
  const draftRestored = vi.fn()
  const notify = vi.fn(async () => undefined)
  const diagnostic = vi.fn()
  const scheduler = new MailScheduler(base.repo, base.accounts, base.assets, base.drafts, base.send, {
    changed,
    draftRestored,
    notify,
    diagnostic,
    context: () => base.ctx,
    scoped: ctx => ctx,
  })
  return { ...base, scheduler, changed, draftRestored, notify, diagnostic }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("external mail scheduled sends", () => {
  it("creates a scheduled send for a specific future timestamp, locks the draft, enforces idempotency and protects assets", async () => {
    const r = await scheduledRig()
    try {
      const attachment = await r.assets.put(r.ctx, Readable.from([Buffer.from("pdf-bytes")]), {
        accountId: r.account.id,
        name: "plan.pdf",
        mime: "application/pdf",
      })
      const updatedDraft = await r.drafts.execute(r.ctx, "draft.update", {
        draftId: r.draft.id,
        expectedRevision: r.draft.revision,
        patch: { assetIds: [attachment.id] },
      })
      const preview = await r.send.preview(r.ctx, { draftId: updatedDraft.id, expectedRevision: updatedDraft.revision })
      const futureIso = new Date(Date.now() + 2 * 60 * 60_000).toISOString()
      const requestId = randomUUID()

      const created = await r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: futureIso,
        clientRequestId: requestId,
        confirmed: true,
      })
      expect(created.state).toBe("pending")
      expect(created.sendAt).toBe(futureIso)
      expect(created.attachments).toHaveLength(1)

      // Idempotent replay returns the same scheduled item
      const replayed = await r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: futureIso,
        clientRequestId: requestId,
        confirmed: true,
      })
      expect(replayed.id).toBe(created.id)

      // Source draft is locked as scheduled and cannot be edited or deleted directly
      expect((await r.drafts.get(r.ctx, updatedDraft.id)).state).toBe("scheduled")
      await expect(r.drafts.execute(r.ctx, "draft.update", {
        draftId: updatedDraft.id,
        expectedRevision: updatedDraft.revision,
        patch: { subject: "Edited" },
      })).rejects.toMatchObject({ code: "DRAFT_SCHEDULED" })
      await expect(r.drafts.execute(r.ctx, "draft.delete", {
        draftId: updatedDraft.id,
        expectedRevision: updatedDraft.revision,
      })).rejects.toMatchObject({ code: "DRAFT_SCHEDULED" })

      // Asset pins survive rebuildPins and cache.clear
      await r.assets.rebuildPins(r.ctx, r.account.id)
      await r.assets.clearCache(r.ctx, r.account.id)
      expect((await r.assets.read(r.ctx, attachment.id)).toString()).toBe("pdf-bytes")

      // Listing returns scheduled item
      const list = await r.scheduler.list(r.ctx, { accountId: r.account.id, limit: 50 })
      expect(list.items).toHaveLength(1)
      expect(list.items[0].id).toBe(created.id)
    } finally {
      await r.scheduler.dispose()
      await r.close()
    }
  })

  it("rejects past timestamps and timestamps beyond 10 years, and supports multi-year future dates without 32-bit timer overflow", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"))
    const r = await scheduledRig()
    try {
      const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
      await expect(r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: "2026-11-25T09:59:00.000Z",
        clientRequestId: randomUUID(),
        confirmed: true,
      })).rejects.toMatchObject({ code: "INVALID_SCHEDULE_TIME" })

      await expect(r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: "2040-01-01T00:00:00.000Z",
        clientRequestId: randomUUID(),
        confirmed: true,
      })).rejects.toMatchObject({ code: "INVALID_SCHEDULE_TIME" })

      // 2 years in the future (> 24.8 days 32-bit setTimeout limit) with explicit timezone offset
      const created = await r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: "2028-06-15T14:30:00+08:00",
        clientRequestId: randomUUID(),
        confirmed: true,
      })
      expect(created.sendAt).toBe("2028-06-15T06:30:00.000Z")

      // Advancing 2 hours must NOT prematurely send due to timer overflow
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
      expect(r.smtp.submit).not.toHaveBeenCalled()
      expect((await r.scheduler.get(r.ctx, { scheduledId: created.id })).state).toBe("pending")
    } finally {
      await r.scheduler.dispose()
      await r.close()
    }
  })

  it("sends on time with fresh Date header, consumes the source draft and emits sent notification", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"))
    const r = await scheduledRig()
    try {
      const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
      const created = await r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: "2026-11-25T15:00:00.000Z",
        clientRequestId: randomUUID(),
        confirmed: true,
      })

      let submittedRaw = ""
      vi.mocked(r.smtp.submit).mockImplementation(async snapshot => {
        submittedRaw = snapshot.raw.toString("utf8")
        return { accepted: snapshot.to, rejected: [], messageId: snapshot.messageId }
      })

      // Jump to 15:10 (within 30-minute grace window) and tick
      vi.setSystemTime(new Date("2026-11-25T15:10:00.000Z"))
      await r.scheduler.tick(r.ctx)

      expect(r.smtp.submit).toHaveBeenCalledTimes(1)
      expect(submittedRaw).toContain("Date: Wed, 25 Nov 2026 15:10:00 +0000")
      const detail = await r.scheduler.get(r.ctx, { scheduledId: created.id })
      expect(detail.state).toBe("sent")
      expect(detail.operationId).toBeTruthy()
      expect(detail.receipt?.state).toBe("accepted")
      expect((await r.drafts.get(r.ctx, r.draft.id)).state).toBe("consumed")
      expect(r.notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scheduledId: created.id, kind: "sent" }))
    } finally {
      await r.scheduler.dispose()
      await r.close()
    }
  })

  it("marks overdue sends beyond 30-minute grace window as missed without calling SMTP, and allows reschedule or manual send_now", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"))
    const r = await scheduledRig()
    try {
      const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
      const created = await r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: "2026-11-25T11:00:00.000Z",
        clientRequestId: randomUUID(),
        confirmed: true,
      })

      // 31 minutes past scheduled send time -> missed
      vi.setSystemTime(new Date("2026-11-25T11:31:00.000Z"))
      await r.scheduler.tick(r.ctx)
      expect(r.smtp.submit).not.toHaveBeenCalled()

      const missed = await r.scheduler.get(r.ctx, { scheduledId: created.id })
      expect(missed.state).toBe("missed")
      expect(missed.errorCode).toBe("SCHEDULE_MISSED")
      expect(r.notify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scheduledId: created.id, kind: "missed" }))

      // User can reschedule back to pending
      const rescheduled = await r.scheduler.reschedule(r.ctx, {
        scheduledId: missed.id,
        expectedRevision: missed.revision,
        sendAt: "2026-11-25T13:00:00.000Z",
      })
      expect(rescheduled.state).toBe("pending")
      expect(rescheduled.sendAt).toBe("2026-11-25T13:00:00.000Z")

      // User can manually trigger send_now
      const receipt = await r.scheduler.sendNow(r.ctx, {
        scheduledId: rescheduled.id,
        expectedRevision: rescheduled.revision,
        confirmed: true,
      })
      expect(receipt.state).toBe("accepted")
      expect(r.smtp.submit).toHaveBeenCalledTimes(1)
      expect((await r.scheduler.get(r.ctx, { scheduledId: created.id })).state).toBe("sent")
    } finally {
      await r.scheduler.dispose()
      await r.close()
    }
  })

  it("retries transient pre-submit network failure within grace window and never resends unknown outcomes", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"))
    const r = await scheduledRig()
    try {
      const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
      const created = await r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: "2026-11-25T10:05:00.000Z",
        clientRequestId: randomUUID(),
        confirmed: true,
      })

      // First attempt fails before submission (definitelyNotSubmitted: true)
      vi.mocked(r.smtp.submit).mockRejectedValueOnce(new MailError("NETWORK_ERROR", "offline", { definitelyNotSubmitted: true }))
      vi.setSystemTime(new Date("2026-11-25T10:05:05.000Z"))
      await r.scheduler.tick(r.ctx)

      const retrying = await r.scheduler.get(r.ctx, { scheduledId: created.id })
      expect(retrying.state).toBe("pending")
      expect(retrying.errorCode).toBe("NETWORK_ERROR")
      expect(retrying.operationId).toBeNull()
      // Transient failed operation should be cleaned up so retries do not accumulate stale receipts
      const opsAfterRetry = await r.repo.page(r.ctx, "operations", { accountId: r.account.id, limit: 20 })
      expect(opsAfterRetry.items).toHaveLength(0)

      // Second attempt fails with uncertain outcome -> unknown, never retried
      vi.mocked(r.smtp.submit).mockRejectedValueOnce(new MailError("NETWORK_TIMEOUT", "uncertain"))
      vi.setSystemTime(new Date("2026-11-25T10:06:10.000Z"))
      await r.scheduler.tick(r.ctx)

      const unknown = await r.scheduler.get(r.ctx, { scheduledId: created.id })
      expect(unknown.state).toBe("unknown")
      expect(unknown.operationId).toBeTruthy()
      await expect(r.scheduler.sendNow(r.ctx, {
        scheduledId: unknown.id,
        expectedRevision: unknown.revision,
        confirmed: true,
      })).rejects.toMatchObject({ code: "SEND_OUTCOME_UNKNOWN" })
      expect(r.smtp.submit).toHaveBeenCalledTimes(2)
    } finally {
      await r.scheduler.dispose()
      await r.close()
    }
  })

  it("respects paused account, blocks changed SMTP endpoints, restores draft on cancel, and guards account deletion", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"))
    const r = await scheduledRig()
    try {
      const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
      const created = await r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: "2026-11-25T10:05:00.000Z",
        clientRequestId: randomUUID(),
        confirmed: true,
      })

      // Account delete requires discardScheduledSends
      const currentAccount = await r.accounts.get(r.ctx, r.account.id)
      await expect(r.accounts.remove(r.ctx, {
        accountId: currentAccount.id,
        expectedRevision: currentAccount.revision,
        discardLocalDrafts: true,
        acknowledgeUnknownOperations: true,
        discardScheduledSends: false,
      })).rejects.toMatchObject({ code: "REMOVAL_REVIEW_REQUIRED" })

      // Paused account does not auto-send
      await r.accounts.pause(r.ctx, r.account.id)
      vi.setSystemTime(new Date("2026-11-25T10:05:05.000Z"))
      await r.scheduler.tick(r.ctx)
      const pausedMissed = await r.scheduler.get(r.ctx, { scheduledId: created.id })
      expect(pausedMissed.state).toBe("missed")
      expect(pausedMissed.errorCode).toBe("ACCOUNT_PAUSED")
      expect(r.smtp.submit).not.toHaveBeenCalled()

      // Cancel restores source draft back to editing
      const cancelled = await r.scheduler.cancel(r.ctx, {
        scheduledId: pausedMissed.id,
        expectedRevision: pausedMissed.revision,
        restoreDraft: true,
      })
      expect(cancelled.state).toBe("cancelled")
      expect((await r.drafts.get(r.ctx, r.draft.id)).state).toBe("editing")
      expect(r.draftRestored).toHaveBeenCalledWith(expect.anything(), r.draft.id)
    } finally {
      await r.scheduler.dispose()
      await r.close()
    }
  })

  it("blocks scheduled dispatch when account SMTP endpoint changed after scheduling", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"))
    const r = await scheduledRig()
    try {
      const preview = await r.send.preview(r.ctx, { draftId: r.draft.id, expectedRevision: r.draft.revision })
      const created = await r.scheduler.create(r.ctx, {
        previewId: preview.previewId,
        sendAt: "2026-11-25T10:05:00.000Z",
        clientRequestId: randomUUID(),
        confirmed: true,
      })

      await r.accounts.update(r.ctx, {
        accountId: r.account.id,
        expectedRevision: r.account.revision,
        patch: { smtp: { host: "other.example.com", port: 465, security: "tls" } },
      })
      await r.accounts.inspect(r.ctx, r.account.id)

      vi.setSystemTime(new Date("2026-11-25T10:05:10.000Z"))
      await r.scheduler.tick(r.ctx)

      expect(r.smtp.submit).not.toHaveBeenCalled()
      const failed = await r.scheduler.get(r.ctx, { scheduledId: created.id })
      expect(failed.state).toBe("failed")
      expect(failed.errorCode).toBe("ACCOUNT_CHANGED")
    } finally {
      await r.scheduler.dispose()
      await r.close()
    }
  })

  it("keeps armed timer alive when the short-lived create() request signal aborts, and returns inline image CIDs or unavailable fallback in readBody", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"))
    const r = await scheduledRig()
    try {
      // 1x1 PNG bytes for rasterMime validation
      const pngBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      )
      const img = await r.assets.put(r.ctx, Readable.from([pngBytes]), {
        accountId: r.account.id,
        name: "dot.png",
        mime: "image/png",
      })
      const updatedDraft = await r.drafts.execute(r.ctx, "draft.update", {
        draftId: r.draft.id,
        expectedRevision: r.draft.revision,
        patch: {
          html: '<p>图<img src="cid:dot1" /></p>',
          inlineImages: [{ assetId: img.id, cid: "dot1" }],
        },
      })
      const preview = await r.send.preview(r.ctx, { draftId: updatedDraft.id, expectedRevision: updatedDraft.revision })

      // Pass a short-lived request AbortController to create(), then abort it immediately after create returns
      const reqAbort = new AbortController()
      const reqCtx = { ...r.ctx, signal: reqAbort.signal }
      const created = await r.scheduler.create(reqCtx, {
        previewId: preview.previewId,
        sendAt: "2026-11-25T10:05:00.000Z",
        clientRequestId: randomUUID(),
        confirmed: true,
      })
      reqAbort.abort()

      const body = await r.scheduler.readBody(r.ctx, created.id)
      expect(body.cid.dot1).toEqual({ mime: "image/png", base64: pngBytes.toString("base64") })
      expect(body.unavailable).toBeUndefined()

      // Timer must still fire via long-lived sync context even though reqAbort was aborted
      const tickSpy = vi.spyOn(r.scheduler, "tick")
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 500)
      expect(tickSpy).toHaveBeenCalledTimes(1)
      // Await the in-flight tickTask returned by tick() until disk I/O and SMTP finish
      await r.scheduler.tick(r.ctx)
      expect(r.smtp.submit).toHaveBeenCalledTimes(1)
      expect((await r.scheduler.get(r.ctx, { scheduledId: created.id })).state).toBe("sent")

      // When a sent/cancelled record's body asset has been evicted, readBody returns unavailable: true gracefully
      const cancelledDraft = await r.drafts.execute(r.ctx, "draft.create", {
        accountId: r.account.id,
        to: [{ address: "to@example.com" }],
        cc: [],
        bcc: [],
        subject: "Cancel Me",
        html: "<p>Bye</p>",
        text: "Bye",
        assetIds: [],
        inlineImages: [],
      })
      const cancelPreview = await r.send.preview(r.ctx, { draftId: cancelledDraft.id, expectedRevision: cancelledDraft.revision })
      const toCancel = await r.scheduler.create(r.ctx, {
        previewId: cancelPreview.previewId,
        sendAt: "2026-11-25T12:00:00.000Z",
        clientRequestId: randomUUID(),
        confirmed: true,
      })
      const cancelled = await r.scheduler.cancel(r.ctx, {
        scheduledId: toCancel.id,
        expectedRevision: toCancel.revision,
        restoreDraft: true,
      })
      const restoredDraft = await r.drafts.get(r.ctx, cancelledDraft.id)
      await r.drafts.execute(r.ctx, "draft.delete", { draftId: restoredDraft.id, expectedRevision: restoredDraft.revision })
      vi.setSystemTime(new Date("2026-11-25T13:00:00.000Z"))
      await r.send.expire(r.ctx)
      await r.assets.rebuildPins(r.ctx, r.account.id)
      await r.assets.remove(r.ctx, cancelled.bodyRef)
      const afterClear = await r.scheduler.readBody(r.ctx, cancelled.id)
      expect(afterClear.unavailable).toBe(true)
    } finally {
      await r.scheduler.dispose()
      await r.close()
    }
  })
})
