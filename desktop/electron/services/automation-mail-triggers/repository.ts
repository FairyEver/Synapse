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
      configurationGeneration: input.configurationGeneration ?? id,
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
  private async updateRecord(namespace: DataNamespace<MailTriggerRecord>, id: string, update: (row: MailTriggerRecord) => Partial<MailTriggerRecord> | null): Promise<boolean> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await namespace.get(id)
      if (!row) return false
      const patch = update(row)
      if (!patch) return false
      if ((await this.batch({ guards: [{ namespace: namespace.name, id, expected: { revision: row.revision, state: row.state } }],
        operations: [{ kind: "patch", namespace: namespace.name, id, patch: { ...patch, revision: row.revision + 1 } }] })).committed) return true
    }
    throw new Error("收信来源状态持续变化，请稍后重试")
  }
  updateSource(id: string, update: (row: SourceRow) => Partial<SourceRow> | null): Promise<boolean> { return this.updateRecord(this.sources, id, row => update(row as SourceRow)) }
  updateSubscription(id: string, update: (row: SubscriptionRow) => Partial<SubscriptionRow> | null): Promise<boolean> { return this.updateRecord(this.subscriptions, id, row => update(row as SubscriptionRow)) }
  async retireGeneration(root: SubscriptionRow): Promise<void> {
    let after: string | undefined
    do {
      const page = await this.subscriptions.queryRange!({ index: "identity_automation", equal: { ownerId: root.ownerId, apiOrigin: root.apiOrigin, automationId: root.automationId },
        ...(after ? { range: { field: "id", gt: after } } : {}), direction: "asc", limit: 50 }) as SubscriptionRow[]
      for (const row of page) if ((row.configurationGeneration ?? row.id) === (root.configurationGeneration ?? root.id)) {
        await this.updateSubscription(row.id, fresh => fresh.state === "retired" ? null : { state: "retired", errorCode: "SUBSCRIPTION_CHANGED" })
      }
      after = page.length === 50 ? page.at(-1)!.id : undefined
    } while (after)
  }
  async getSource(subscriptionId: string, sourceKey: string): Promise<SourceRow | null> { return await this.sources.get(hash([subscriptionId, sourceKey])) as SourceRow | null }
  async closedSubscriptions(automationId: string, identity: MailTriggerIdentity): Promise<SubscriptionRow[]> {
    return await this.subscriptions.queryRange!({ index: "identity_automation_state", equal: { ...identity, automationId, state: "closed" }, direction: "asc", limit: 50 }) as SubscriptionRow[]
  }
  async addSources(subscriptionId: string, boundaries: import("./types").MailSourceBoundary[]): Promise<void> {
    for (const boundary of boundaries) {
      const root = await this.getSubscription(subscriptionId)
      if (!root || root.state !== "ready") throw new Error("收信订阅不可用")
      const id = hash([subscriptionId, boundary.sourceKey])
      if (await this.sources.get(id)) continue
      const value: SourceRow = { ...root, id, kind: "source", sourceKey: boundary.sourceKey, boundary, revision: 0,
        cursor: boundary.kind === "mail-internal" ? boundary.receiptSequence : String(boundary.uidNext - 1) }
      const result = await this.batch({ guards: [{ namespace: this.subscriptions.name, id: root.id, expected: { revision: root.revision, state: "ready" } }], operations: [
        { kind: "insert", namespace: this.sources.name, id, value }, { kind: "patch", namespace: this.subscriptions.name, id: root.id, patch: { revision: root.revision + 1 } },
      ] })
      if (!result.committed) throw new Error("收信来源接入状态已变化")
    }
  }
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
  async rowsInState(automationId: string, identity: MailTriggerIdentity, state: MailTriggerRecord["state"]): Promise<DeliveryRow[]> {
    return await this.deliveries.queryRange!({ index: "identity_automation_state", equal: { ...identity, automationId, state }, direction: "asc", limit: 50 }) as DeliveryRow[]
  }
  async deferDelivery(row: DeliveryRow, retryAt: number, errorCode: string): Promise<void> {
    const result = await this.batch({ guards: [{ namespace: this.deliveries.name, id: row.id, expected: { revision: row.revision, state: row.state } }],
      operations: [{ kind: "patch", namespace: this.deliveries.name, id: row.id, patch: { retryAt, errorCode, revision: row.revision + 1 } }] })
    if (!result.committed) throw new Error("收信投递重试状态已变化")
  }
  async refreshMetadata(row: DeliveryRow, receivedAt: string): Promise<boolean> {
    return (await this.batch({ guards: [{ namespace: this.deliveries.name, id: row.id, expected: { revision: row.revision, state: "awaiting_metadata" } }],
      operations: [{ kind: "patch", namespace: this.deliveries.name, id: row.id, patch: { receipt: { ...row.receipt, receivedAt }, state: "pending", retryAt: 0, revision: row.revision + 1 } }] })).committed
  }
  async commitDispatch(id: string, revision: number, runId: string, state: "pending" | "awaiting_metadata" = "pending"): Promise<boolean> {
    return (await this.batch({ guards: [{ namespace: this.deliveries.name, id, expected: { revision, state } }],
      operations: [{ kind: "patch", namespace: this.deliveries.name, id, patch: { state: "submitted", runId, revision: revision + 1 } }] })).committed
  }
  async releaseUnstartedDispatch(id: string, runId: string): Promise<void> {
    await this.updateRecord(this.deliveries, id, row => row.state === "submitted" && row.runId === runId ? { state: "pending", runId: undefined, retryAt: 0 } : null)
  }
  async finishDispatch(id: string, result: DeliveryOutcome): Promise<void> {
    const row = await this.deliveries.get(id)
    if (!row) throw new Error("收信投递记录不存在")
    const committed = await this.batch({ guards: [{ namespace: this.deliveries.name, id, expected: { revision: row.revision, state: row.state } }],
      operations: [{ kind: "patch", namespace: this.deliveries.name, id, patch: { ...result, revision: row.revision + 1 } }] })
    if (!committed.committed) throw new Error("收信投递状态已变化")
  }
  async deleteAutomationState(automationId: string): Promise<void> {
    let after: string | undefined
    do {
      const roots = await this.subscriptions.queryRange!({ index: "automation_id", equal: { automationId }, ...(after ? { range: { field: "id", gt: after } } : {}), direction: "asc", limit: 50 })
      for (const row of roots) await this.subscriptions.upsert({ ...row, state: "retired", errorCode: "DELETE_PENDING", revision: row.revision + 1 })
      after = roots.length === 50 ? roots.at(-1)!.id : undefined
    } while (after)
    for (const namespace of [this.deliveries, this.sources, this.subscriptions]) {
      while (true) {
        const page = await namespace.queryRange!({ index: "automation_id", equal: { automationId }, direction: "asc", limit: 50 })
        if (!page.length) break
        for (const row of page) await namespace.remove(row.id)
      }
    }
  }
  async resumeDeletes(identity: MailTriggerIdentity): Promise<void> {
    const roots = await this.subscriptions.queryRange!({ index: "identity_error", equal: { ...identity, errorCode: "DELETE_PENDING" }, direction: "asc", limit: 50 })
    for (const automationId of new Set(roots.map(row => row.automationId))) await this.deleteAutomationState(automationId)
  }
}
