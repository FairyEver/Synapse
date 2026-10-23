import { expect, it, vi } from "vitest"
import { syncRig } from "./sync-fixtures"
import { MailNotifications } from "../notifications"
import { createMailNotificationAdapter } from "../notification-adapter"
import { messageSummary, type StoredMessage } from "../sync"
it("deduplicates before native presentation, suppresses baseline and aggregates new mail for five seconds", async () => {
  vi.useFakeTimers(); const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2, 3]); await r.sync.runOnce(r.ctx, r.account.id)
    const rows = (await r.repo.page<StoredMessage>(r.ctx, "messages", { accountId: r.account.id })).items
    const show = vi.fn(), open = vi.fn(), diagnostic = vi.fn()
    const notifications = new MailNotifications(r.repo, r.accounts, { show }, open, diagnostic, r.access)
    await notifications.accept(r.ctx, { accountId: r.account.id, baseline: true, messages: [messageSummary(rows[0])] })
    await notifications.accept(r.ctx, { accountId: r.account.id, baseline: false, messages: [messageSummary(rows[0])] })
    await vi.advanceTimersByTimeAsync(5000); expect(show).not.toHaveBeenCalled()
    const delta = { accountId: r.account.id, baseline: false, messages: rows.slice(1).map(messageSummary) }
    await notifications.accept(r.ctx, delta); await notifications.accept(r.ctx, delta)
    await vi.advanceTimersByTimeAsync(4999); expect(show).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(show).toHaveBeenCalledTimes(1)
    expect(show.mock.calls[0][0]).toMatchObject({ title: "Work", accountId: r.account.id, messageId: null, body: "2 封新邮件" })
    await show.mock.calls[0][0].onClick(); expect(open).toHaveBeenCalledWith(r.ctx, { accountId: r.account.id, messageId: null })
    notifications.dispose()
  } finally { vi.useRealTimers(); await r.sync.dispose(); await r.close() }
})
it("keeps receiving when notifications are disabled and invalidates a previously displayed click on identity change", async () => {
  vi.useFakeTimers(); const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1, 2]); await r.sync.runOnce(r.ctx, r.account.id)
    const rows = (await r.repo.page<StoredMessage>(r.ctx, "messages", { accountId: r.account.id })).items
    const show = vi.fn(), open = vi.fn(), diagnostic = vi.fn(), notifications = new MailNotifications(r.repo, r.accounts, { show }, open, diagnostic, r.access)
    const disabled = await r.accounts.update(r.ctx, { accountId: r.account.id, expectedRevision: r.account.revision, patch: { notify: false } })
    await notifications.accept(r.ctx, { accountId: r.account.id, baseline: false, messages: [messageSummary(rows[0])] })
    await vi.advanceTimersByTimeAsync(5000); expect(show).not.toHaveBeenCalled()
    expect((await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items).toHaveLength(2)
    await r.accounts.update(r.ctx, { accountId: r.account.id, expectedRevision: disabled.revision, patch: { notify: true } })
    await notifications.accept(r.ctx, { accountId: r.account.id, baseline: false, messages: [messageSummary(rows[1])] })
    await vi.advanceTimersByTimeAsync(5000); expect(show).toHaveBeenCalledTimes(1)
    r.setOwner("other")
    await show.mock.calls[0][0].onClick(); expect(open).not.toHaveBeenCalled()
    notifications.dispose()
  } finally { vi.useRealTimers(); await r.sync.dispose(); await r.close() }
})
it("contains native permission/support failures locally", () => {
  const failure = vi.fn(), create = vi.fn()
  const adapter = createMailNotificationAdapter({ isSupported: () => false, create }, failure)
  adapter.show({ title: "Work", body: "New mail", accountId: "account", messageId: null, onClick: async () => undefined })
  expect(create).not.toHaveBeenCalled(); expect(failure).toHaveBeenCalledWith("NATIVE_UNSUPPORTED")
})
it("records notification permission denial locally while preserving reception and dedupe", async () => {
  vi.useFakeTimers(); const r = await syncRig()
  try {
    vi.mocked(r.session.searchUids).mockResolvedValue([1]); await r.sync.runOnce(r.ctx, r.account.id)
    const message = messageSummary((await r.repo.page<StoredMessage>(r.ctx, "messages", { accountId: r.account.id })).items[0])
    const show = vi.fn(), diagnostic = vi.fn()
    r.access.mockRejectedValue(new Error("permission denied"))
    const notifications = new MailNotifications(r.repo, r.accounts, { show }, vi.fn(), diagnostic, r.access)
    await notifications.accept(r.ctx, { accountId: r.account.id, messages: [message], baseline: false })
    await vi.advanceTimersByTimeAsync(5000)
    expect(show).not.toHaveBeenCalled(); expect(diagnostic).toHaveBeenCalled()
    expect((await r.repo.get(r.ctx, "messages", message.id)).id).toBe(message.id)
    notifications.dispose()
  } finally { vi.useRealTimers(); await r.sync.dispose(); await r.close() }
})
