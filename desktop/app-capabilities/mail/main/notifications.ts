import { createHash } from "node:crypto"
import { MailError, type InboxDelta, type MailContext, type MailSummary } from "../shared/types"
import { MAIL_NOTIFICATION_WINDOW_MS } from "../shared/limits"
import { MailRepository } from "./repository"
import { MailAccounts } from "./accounts"
import { resolveMessage } from "./sync"
import type { MailNotificationAdapter } from "./notification-adapter"
import type { MailAccess } from "./assets"

interface PendingNotification { ctx: MailContext; accountId: string; count: number; first: MailSummary; timer: ReturnType<typeof setTimeout>; abort(): void }
const summary = (value: string, max: number) => value.replace(/[\x00-\x1f\x7f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max)
export class MailNotifications {
  private pending = new Map<string, PendingNotification>()
  constructor(private readonly repo: MailRepository, private readonly accounts: MailAccounts, private readonly adapter: MailNotificationAdapter, private readonly open: (ctx: MailContext, target: { accountId: string; messageId: string | null }) => Promise<void>, private readonly diagnostic: (code: string, accountId: string) => void, private readonly access: MailAccess) {}
  async accept(ctx: MailContext, change: InboxDelta): Promise<void> {
    const account = await this.accounts.get(ctx, change.accountId)
    for (const message of change.messages) {
      if (message.accountId !== change.accountId || message.locator.accountId !== change.accountId || message.stale) throw new MailError("UNAVAILABLE", "通知邮件不属于此账号")
      const locator = message.locator
      const id = `notification:${createHash("sha256").update(JSON.stringify([ctx.ownerId, change.accountId, locator.folderId, locator.uidValidity, locator.uid])).digest("hex")}`
      if (await this.repo.find(ctx, "sync-state", id)) continue
      try { await this.repo.save(ctx, "sync-state", id, change.accountId, { kind: "notification", messageId: message.id, locator }, 0) } catch (error) {
        if (error instanceof MailError && error.code === "VERSION_CONFLICT") continue
        throw error
      }
      // Dedupe is durable even while disabled, so enabling notifications never floods old arrivals.
      if (change.baseline || !account.notify) continue
      const key = `${ctx.ownerId}:${change.accountId}`
      const existing = this.pending.get(key)
      if (existing) { existing.count++; continue }
      const abort = () => { const entry = this.pending.get(key); if (entry) { clearTimeout(entry.timer); ctx.signal.removeEventListener("abort", entry.abort); this.pending.delete(key) } }
      const timer = setTimeout(() => { void this.flush(key).catch(() => this.diagnostic("NOTIFICATION_FAILED", change.accountId)) }, MAIL_NOTIFICATION_WINDOW_MS)
      this.pending.set(key, { ctx, accountId: change.accountId, count: 1, first: message, timer, abort })
      ctx.signal.addEventListener("abort", abort, { once: true })
      if (ctx.signal.aborted) abort()
    }
  }
  private async flush(key: string): Promise<void> {
    const entry = this.pending.get(key)
    if (!entry) return
    this.pending.delete(key); entry.ctx.signal.removeEventListener("abort", entry.abort)
    try {
      this.accounts.context.assertCurrent(entry.ctx)
      const account = await this.accounts.get(entry.ctx, entry.accountId)
      if (!account.notify) return
      const sender = entry.first.from.map(a => a.name || a.address).join(", ")
      const messageId = entry.count === 1 ? entry.first.id : null
      await this.access(entry.ctx, "notification.trigger", entry.accountId)
      this.adapter.show({ title: summary(account.name, 100), body: entry.count === 1 ? summary(`${sender}：${entry.first.subject}`, 200) : `${entry.count} 封新邮件`, accountId: entry.accountId, messageId, onClick: async () => {
        try {
          this.accounts.context.assertCurrent(entry.ctx)
          await this.accounts.get(entry.ctx, entry.accountId)
          if (messageId) await resolveMessage(this.repo, entry.ctx, messageId)
          await this.open(entry.ctx, { accountId: entry.accountId, messageId })
        } catch { this.diagnostic("NOTIFICATION_TARGET_UNAVAILABLE", entry.accountId) }
      } })
    } catch { this.diagnostic(entry.ctx.signal.aborted ? "NOTIFICATION_SCOPE_EXPIRED" : "NOTIFICATION_PERMISSION_OR_PRESENTATION_FAILED", entry.accountId) }
  }
  dispose(): void {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.ctx.signal.removeEventListener("abort", entry.abort) }
    this.pending.clear()
    this.adapter.dispose?.()
  }
}
