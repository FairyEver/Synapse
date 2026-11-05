import { createHash, randomUUID } from "node:crypto"
import type { AtomicBatchRequest, DataNamespace, DataRepository } from "../../runtime/data-repo"
import type { MailTriggerRecord } from "../../runtime/data-repo/schemas/automation-mail-triggers"
import type { DeliveryOutcome, DeliveryRow, MailReceiptPage, MailTriggerIdentity, PrepareSubscriptionInput, SourceRow, SubscriptionRow } from "./types"

const prefix = "app.automation-mail."
const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex")
export class MailTriggerRepository {
  readonly subscriptions: DataNamespace<MailTriggerRecord>
  readonly sources: DataNamespace<MailTriggerRecord>
  readonly deliveries: DataNamespace<MailTriggerRecord>
  constructor(private readonly storage: DataRepository) {
    this.subscriptions = storage.namespace(`${prefix}subscriptions`)
    this.sources = storage.namespace(`${prefix}sources`)
    this.deliveries = storage.namespace(`${prefix}deliveries`)
  }
  private batch(request: AtomicBatchRequest) {
    if (!this.storage.commitBatch) throw new Error("收信自动化需要原子存储")
    return this.storage.commitBatch(request)
  }
  async prepareSubscription(input: PrepareSubscriptionInput): Promise<string> {
    if (!input.boundaries.length || new Set(input.boundaries.map(b => b.sourceKey)).size !== input.boundaries.length) throw new Error("收信来源为空或重复")
    const id = `mail-subscription:${randomUUID()}`
    const base = { id, schemaVersion: 1 as const, ...input.identity, automationId: input.automationId, subscriptionId: id, sourceKey: "", revision: 0,
      state: "ready" as const, createdAt: new Date().toISOString(), orderKey: id, retryAt: 0 }
    for (const boundary of input.boundaries) {
      const value: SourceRow = { ...base, id: hash([id, boundary.sourceKey]), kind: "source", sourceKey: boundary.sourceKey, boundary,
        cursor: boundary.kind === "mail-internal" ? boundary.receiptSequence : String(boundary.uidNext - 1) }
      await this.sources.upsert(value)
    }
    await this.subscriptions.upsert({ ...base, kind: "subscription" })
    return id
  }
  async getSubscription(id: string): Promise<SubscriptionRow | null> { return await this.subscriptions.get(id) as SubscriptionRow | null }
  async sourcesFor(subscriptionId: string): Promise<SourceRow[]> {
    const rows: SourceRow[] = []; let after: string | undefined
    do {
      const page = await this.sources.queryRange!({ index: "subscription_source", equal: { subscriptionId }, ...(after ? { range: { field: "sourceKey", gt: after } } : {}), direction: "asc", limit: 100 }) as SourceRow[]
      rows.push(...page); after = page.length === 100 ? page.at(-1)!.sourceKey : undefined
    } while (after)
    return rows
  }
  async enqueuePage(subscriptionId: string, sourceKey: string, expectedRevision: number, page: MailReceiptPage): Promise<boolean> {
    if (page.receipts.length > 50 || page.receipts.some(r => r.sourceKey !== sourceKey)) throw new Error("收信批次来源无效")
    const source = await this.sources.get(hash([subscriptionId, sourceKey])) as SourceRow | null
    if (!source || source.revision !== expectedRevision || source.state !== "ready") return false
    const operations: AtomicBatchRequest["operations"][number][] = []
    const seen = new Set<string>()
    for (const receipt of page.receipts) {
      const id = hash([source.apiOrigin, source.ownerId, source.automationId, receipt.receiptKey])
      if (seen.has(id)) continue
      seen.add(id)
      const prior = await this.deliveries.get(id)
      if (prior) {
        if (prior.state === "awaiting_metadata" && receipt.receivedAt) operations.push({ kind: "patch", namespace: this.deliveries.name, id, patch: { receipt, state: "pending", revision: prior.revision + 1 } })
        continue
      }
      const value: DeliveryRow = { id, kind: "delivery", schemaVersion: 1, ownerId: source.ownerId, apiOrigin: source.apiOrigin,
        automationId: source.automationId, subscriptionId, sourceKey, revision: 0, state: receipt.receivedAt ? "pending" : "awaiting_metadata",
        createdAt: new Date().toISOString(), orderKey: `${receipt.receivedAt ?? "9999"}:${receipt.receiptKey}`, retryAt: 0, receipt }
      operations.push({ kind: "insert", namespace: this.deliveries.name, id, value })
    }
    operations.push({ kind: "patch", namespace: this.sources.name, id: source.id, patch: { cursor: page.nextCursor, revision: source.revision + 1 } })
    return (await this.batch({ guards: [{ namespace: this.sources.name, id: source.id, expected: { revision: expectedRevision, state: "ready" } }], operations })).committed
  }
  async nextPending(automationId: string, identity: MailTriggerIdentity): Promise<DeliveryRow | null> {
    const rows = await this.deliveries.queryRange!({ index: "identity_automation_state", equal: { ...identity, automationId, state: "pending" }, direction: "asc", limit: 50 }) as DeliveryRow[]
    return rows.find(row => row.retryAt <= Date.now()) ?? null
  }
  async commitDispatch(id: string, revision: number, runId: string): Promise<boolean> {
    return (await this.batch({ guards: [{ namespace: this.deliveries.name, id, expected: { revision, state: "pending" } }],
      operations: [{ kind: "patch", namespace: this.deliveries.name, id, patch: { state: "submitted", runId, revision: revision + 1 } }] })).committed
  }
  async finishDispatch(id: string, result: DeliveryOutcome): Promise<void> {
    const row = await this.deliveries.get(id)
    if (!row) throw new Error("收信投递记录不存在")
    const committed = await this.batch({ guards: [{ namespace: this.deliveries.name, id, expected: { revision: row.revision, state: row.state } }],
      operations: [{ kind: "patch", namespace: this.deliveries.name, id, patch: { ...result, revision: row.revision + 1 } }] })
    if (!committed.committed) throw new Error("收信投递状态已变化")
  }
}
