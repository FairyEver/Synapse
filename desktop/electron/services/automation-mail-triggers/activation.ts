import type { AutomationItem, AutomationTriggerLifecycle } from "../automation/types"
import { MailTriggerRepository } from "./repository"
import type { MailReceiptSource, MailTriggerContext } from "./types"

export interface MailTriggerActivationDeps {
  repository: MailTriggerRepository
  context(): MailTriggerContext
  sourceFor(triggerType: string): MailReceiptSource | undefined
  listItems(): Promise<AutomationItem[]>
}
export class MailTriggerActivation implements AutomationTriggerLifecycle {
  constructor(private readonly deps: MailTriggerActivationDeps) {}
  private assert(context: MailTriggerContext) {
    context.signal.throwIfAborted()
    const current = this.deps.context()
    if (current.generation !== context.generation || current.identity.apiOrigin !== context.identity.apiOrigin || current.identity.ownerId !== context.identity.ownerId) throw new Error("收信自动化身份已变化")
  }
  async prepare(context: MailTriggerContext, item: AutomationItem): Promise<{ subscriptionId: string }> {
    this.assert(context)
    const source = this.deps.sourceFor(item.trigger.type)
    if (!source) throw new Error("不支持此收信触发器")
    const boundaries = await source.prepare(context, typeof item.trigger.config.accountId === "string" ? item.trigger.config.accountId : undefined)
    this.assert(context)
    return { subscriptionId: await this.deps.repository.prepareSubscription({ identity: context.identity, automationId: item.id, boundaries }) }
  }
  async beforeSave(previous: AutomationItem | null, candidate: AutomationItem): Promise<AutomationItem> {
    if (previous) await this.afterSave(null, previous)
    const binding = previous?.mailSubscription
    const nextIsMail = Boolean(this.deps.sourceFor(candidate.trigger.type))
    if (!nextIsMail || !candidate.enabled) {
      if (nextIsMail && previous?.enabled && binding && !binding.stoppedAt) await this.confirmStop(previous)
      return binding ? { ...candidate, mailSubscription: { ...binding, stoppedAt: binding.stoppedAt ?? new Date().toISOString(), retired: !nextIsMail } } : candidate
    }
    const context = this.deps.context(); this.assert(context)
    if (binding) {
      const old = await this.deps.repository.getSubscription(binding.id)
      if (!old || old.ownerId !== context.identity.ownerId || old.apiOrigin !== context.identity.apiOrigin) throw new Error("收信订阅身份不匹配")
    }
    const changed = previous && JSON.stringify(previous.trigger) !== JSON.stringify(candidate.trigger)
    if (binding && previous?.enabled && !changed && !binding.stoppedAt) return candidate
    const prepared = await this.prepare(context, candidate); this.assert(context)
    return { ...candidate, mailSubscription: { id: prepared.subscriptionId, ...(binding ? { previousId: binding.id, previousEndedAt: binding.stoppedAt ?? new Date().toISOString(), previousRetired: Boolean(changed) } : {}) } }
  }
  async afterSave(_previous: AutomationItem | null, item: AutomationItem): Promise<void> {
    const binding = item.mailSubscription
    if (!binding) return
    if (binding.previousId) await this.close(binding.previousId, binding.previousEndedAt!, Boolean(binding.previousRetired))
    if (binding.stoppedAt) await this.close(binding.id, binding.stoppedAt, Boolean(binding.retired))
  }
  private async close(id: string, endedAt: string, retired: boolean) {
    const row = await this.deps.repository.getSubscription(id)
    const state = retired ? "retired" : "closed"
    if (!row || row.state === "retired" || row.state === state || !retired && row.endedAt) return
    await this.deps.repository.subscriptions.upsert({ ...row, state, endedAt, errorCode: !retired && !row.stopConfirmed ? "STOP_BOUNDARY_UNCONFIRMED" : row.errorCode, revision: row.revision + 1 })
  }
  private async confirmStop(item: AutomationItem): Promise<void> {
    const root = await this.deps.repository.getSubscription(item.mailSubscription!.id)
    if (!root) return
    let confirmed = true
    for (const origin of await this.deps.repository.sourcesFor(root.id)) {
      let endCursor: string | undefined
      try {
        const current = this.deps.context()
        const context = { ...current, signal: AbortSignal.any([current.signal, AbortSignal.timeout(5000)]) }; this.assert(context)
        const source = this.deps.sourceFor(item.trigger.type)
        const boundaries = await source!.prepare(context, origin.boundary.kind === "mail" ? origin.boundary.accountId : undefined); this.assert(context)
        const end = boundaries.find(boundary => boundary.sourceKey === origin.sourceKey)
        if (end) endCursor = end.kind === "mail-internal" ? end.receiptSequence : String(end.uidNext - 1)
      } catch { confirmed = false }
      if (!endCursor) confirmed = false
      const fresh = await this.deps.repository.getSource(root.id, origin.sourceKey)
      if (fresh) await this.deps.repository.sources.upsert({ ...fresh, endCursor, errorCode: endCursor ? undefined : "STOP_BOUNDARY_UNCONFIRMED", revision: fresh.revision + 1 })
    }
    const fresh = await this.deps.repository.getSubscription(root.id)
    if (fresh) await this.deps.repository.subscriptions.upsert({ ...fresh, stopConfirmed: confirmed, revision: fresh.revision + 1 })
  }
  async recoverBindings(): Promise<void> {
    for (const item of await this.deps.listItems()) await this.afterSave(null, item)
  }
}
